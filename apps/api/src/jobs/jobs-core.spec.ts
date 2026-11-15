import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { JOB_CONTRACT_FIXTURE_V1, JOB_STATES, JOB_TERMINAL_KINDS } from '@tyre/shared';
import { JobCursorService, jobDomainHash } from './job-cursor.service';
import { ACTIVE_JOB_HANDLERS, ACTIVE_OUTBOX_CONSUMERS, assertZeroHandlerCore } from './job-handler-registry';
import { JobsConfig, readJobsConfig } from './jobs.config';
import { JobsReaderController } from './jobs-reader.controller';

const key = Buffer.from(Array.from({length:32},(_,i)=>i+1));
const config: JobsConfig = {
  requested:true, enabled:true, pollerEnabled:false, disabledReasons:[], cursorMaxTtlSeconds:300,
  maxCursorBytes:4096, maxPageSize:50, maxTimeRangeSeconds:3600, maxFilters:4, detailPaddingMs:10,
  readerPolicyVersion:7, queryPlanPolicyId:'fixture-plan', runtimeContractDigest:'A'.repeat(43),
  cursorKeys:[{id:'test-key',material:key,state:'issuing',notBefore:Date.parse('2026-07-30T00:00:00.000Z'),verifyUntil:Date.parse('2026-07-31T00:00:00.000Z'),revoked:false}],
};

function payload() {
  return {
    viewerId:'viewer-1',sessionId:'session-1',accountVersion:1,tokenVersion:1,minimumAuthContractVersion:2,
    securityControlVersion:1,authorizationGraphDigestVersion:1 as const,
    authorizationGraphDigest:jobDomainHash('authorization-graph',{grant:'jobs.read'}),readerPolicyVersion:7,
    normalizedFilterHash:jobDomainHash('normalized-filter',{state:'dead_lettered'}),sortField:'createdAt' as const,
    sortDirection:'desc' as const,pageSize:25,asOfCreatedAt:'2026-07-30T00:10:00.000Z',
    lastSortValue:'2026-07-30T00:09:00.000Z',lastCreatedAt:'2026-07-30T00:09:00.000Z',lastJobId:'job-1',
  };
}

test('3C ships no callable handler or consumer and the shared fixture is deeply immutable', () => {
  assertZeroHandlerCore(); assert.equal(ACTIVE_JOB_HANDLERS.length,0); assert.equal(ACTIVE_OUTBOX_CONSUMERS.length,0);
  assert(Object.isFrozen(JOB_CONTRACT_FIXTURE_V1)); assert(Object.isFrozen(JOB_CONTRACT_FIXTURE_V1.detail.attempts));
  assert.deepEqual(JOB_CONTRACT_FIXTURE_V1.detail.allowedActions,[]);
  assert(JOB_STATES.includes('external_outcome_unknown')); assert(JOB_TERMINAL_KINDS.includes('cancelled_before_effect'));
});

test('jc1 is a five-part AES-GCM continuation bound to jobs AAD and closed payload', () => {
  const cursor = new JobCursorService(config); const now=new Date('2026-07-30T00:10:00.000Z');
  const token=cursor.issue(payload(),now); assert.equal(token.split('.').length,5); assert.equal(token.split('.')[0],'jc1');
  assert.deepEqual(cursor.decrypt(token,new Date('2026-07-30T00:11:00.000Z')).viewerId,'viewer-1');
  const parts=token.split('.'); parts[3]=`${parts[3].slice(0,-1)}${parts[3].endsWith('A')?'B':'A'}`;
  assert.throws(()=>cursor.decrypt(parts.join('.'),new Date('2026-07-30T00:11:00.000Z')),/INVALID_JOB_CURSOR/);
});

test('revoked/expired/oversized/cross-policy job cursors disclose one error only', () => {
  const now=new Date('2026-07-30T00:10:00.000Z'); const token=new JobCursorService(config).issue(payload(),now);
  for (const changed of [
    {...config,cursorKeys:[{...config.cursorKeys![0],revoked:true}]},
    {...config,maxCursorBytes:10},
    {...config,readerPolicyVersion:8},
  ] as JobsConfig[]) assert.throws(()=>new JobCursorService(changed).decrypt(token,new Date('2026-07-30T00:11:00.000Z')),/INVALID_JOB_CURSOR/);
  assert.throws(()=>new JobCursorService(config).decrypt(token,new Date('2026-07-31T00:01:00.000Z')),/INVALID_JOB_CURSOR/);
});

test('missing D10/operator configuration disables both reader and poller without defaults', () => {
  const saved={...process.env};
  try {
    for(const name of Object.keys(process.env)) if(name.startsWith('JOBS_')||name==='ADMIN_JOBS_READER_ENABLED') delete process.env[name];
    assert.deepEqual(readJobsConfig(),{requested:false,enabled:false,pollerEnabled:false,disabledReasons:['FLAG_FALSE']});
    process.env.ADMIN_JOBS_READER_ENABLED='true'; const requested=readJobsConfig();
    assert.equal(requested.enabled,false); assert.equal(requested.pollerEnabled,false);
    assert(requested.disabledReasons.includes('JOBS_QUEUE_CAPACITY_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_TOPIC_CAPACITY_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_PARTITION_CAPACITY_MAP_JSON_INVALID'));
    assert(requested.disabledReasons.includes('JOBS_TOPIC_CAPACITY_MAP_JSON_INVALID'));
    assert(requested.disabledReasons.includes('JOBS_CIRCUIT_FAILURE_THRESHOLD_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_OPERATIONAL_POLICY_DIGEST_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_PRODUCER_DATABASE_URL_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_CURSOR_KEY_RING_JSON_INVALID'));
    assert(requested.disabledReasons.includes('JOBS_MAX_FENCE_LOSS_PER_MINUTE_REQUIRED'));
    assert(requested.disabledReasons.includes('JOBS_PRODUCER_BOUNDARY_DIGEST_REQUIRED'));
    process.env.APP_ENV='production'; const production=readJobsConfig();
    assert.equal(production.enabled,false); assert.equal(production.pollerEnabled,false);
    assert(production.disabledReasons.includes('PRODUCTION_HARD_DENY'));
  } finally { process.env=saved; }
});

test('follow-up 20 rejects scalar-only and partition/topic-map policy representation drift', () => {
  const sql=readFileSync(join(process.cwd(),'prisma','migrations','20260730303000_bind_job_policy_representation','migration.sql'),'utf8');
  for(const invariant of [
    'job_policy_document_valid_v4','job_policy_scalars_valid_v4','job_database_policy_digest_v4',
    'validate_job_operational_policy_v4','PARTITION_CAPACITY_MAP','TOPIC_CAPACITY_MAP',
    'job_runtime_boundary_digest_v4','job_runtime_boundary_valid_v4','job_runtime_attestation_v4',
    'job_runtime_key_attestation_v4','JOB_RUNTIME_BOUNDARY_INVALID',
  ]) assert(sql.includes(invariant),`missing follow-up 20 invariant ${invariant}`);
  for(const scalar of [
    'maxAttemptsPerJob','maxHeartbeatsPerJob','maxReconciliationsPerJob','maxFenceLossPerMinute',
    'maxAttemptsPerMinute','maxHeartbeatsPerMinute','maxReconciliationsPerMinute','maxFactsPerMinute',
    'maxAuditsPerMinute','maxFactsPerOrigin','maxAuditsPerOrigin','queueCapacity','partitionCapacity',
    'topicCapacity','rootCapacity','enqueueRatePerMinute','claimRatePerMinute','maxActiveLeases',
    'circuitFailureThreshold','circuitOpenSeconds',
  ]) assert(sql.includes(`p."${scalar}"`),`missing scalar binding ${scalar}`);
  assert.match(sql,/partition_limit:=LEAST\(\(p\."policyDocument"->>'PARTITION_CAPACITY'\)/);
  assert.match(sql,/topic_limit:=LEAST\(\(p\."policyDocument"->>'TOPIC_CAPACITY'\)/);
});

test('follow-up 19 binds the full dependency graph to canonical DB policy and bounded capacity', () => {
  const sql=readFileSync(join(process.cwd(),'prisma','migrations','20260730302000_harden_job_dependencies_and_capacity','migration.sql'),'utf8');
  for(const invariant of [
    'job_operational_policy_digest_v3','JOB_OPERATIONAL_POLICY_DIGEST_INVALID','policyDocument',
    'job_runtime_boundary_digest_v3','job_runtime_boundary_valid_v3','job_runtime_attestation_v3',
    'AuditEventV2','AuditEventScopeRefV2','AuditEventSchemaV2','AuditRuntimeContextKey',
    'AdminRoleAssignment','RolePermission','Permission','StaffSession','SecurityControl',
    'JobCapacityReservation','JobGlobalRateBucket','JobCircuitState','pg_advisory_xact_lock',
    'JOB_QUEUE_CAPACITY_EXCEEDED','JOB_PARTITION_CAPACITY_EXCEEDED','JOB_TOPIC_CAPACITY_EXCEEDED',
    'JOB_ROOT_CAPACITY_EXCEEDED','JOB_ENQUEUE_RATE_EXCEEDED','JOB_CLAIM_RATE_EXCEEDED',
    'JOB_CONCURRENCY_EXCEEDED','JOB_CIRCUIT_OPEN',
  ]) assert(sql.includes(invariant),`missing follow-up 19 invariant ${invariant}`);
  assert.match(sql,/control\."operationalPolicyDigest"<>policy_digest/);
  assert.match(sql,/p\."operationalPolicyDigest"=job_operational_policy_digest_v3\(p\."policyDocument"\)/);
});

test('follow-up migration closes boundary, scope, amplification and growth fail-open paths', () => {
  const sql=readFileSync(join(process.cwd(),'prisma','migrations','20260730301000_harden_zero_handler_job_core','migration.sql'),'utf8');
  for(const invariant of [
    'job_runtime_boundary_digest_v2','job_runtime_boundary_valid_v2','job_runtime_attestation_v2',
    'BackgroundJob_scope_complete_v2','JOB_SCOPE_INCOMPLETE','scope_count=0','scope_kind_count<>cardinality',
    'JOB_PRODUCER_CAPABILITY_DENIED','JOB_CHILD_CAPABILITY_DENIED','JOB_CHILD_DEDUP_INVALID',
    'rootRegistryDigest','JOB_FANOUT_OR_DEPTH_EXCEEDED','ATTEMPT_LIMIT',
    'JobOperationalPolicy','JobOriginRateBucket','JOB_OPERATIONAL_RATE_EXCEEDED',
    'maxFenceLossPerMinute','job_reserve_origin_budget_v2',
  ]) assert(sql.includes(invariant),`missing hardened invariant ${invariant}`);
  assert.match(sql,/boundaryDigest"<>job_runtime_boundary_digest_v2/);
  assert.match(sql,/count\(DISTINCT s\.dimension\).*cardinality\(reg\."requiredScopeKinds"\)/s);
  assert.doesNotMatch(sql,/jobs\.retry|jobs\.resume/);
});

test('migration is additive, zero-seeded and exposes only fenced core entrypoints', () => {
  const sql=readFileSync(join(process.cwd(),'prisma','migrations','20260730300000_add_zero_handler_job_core','migration.sql'),'utf8');
  assert.match(sql,/3C_ZERO_SEED_VIOLATION/); assert.doesNotMatch(sql,/INSERT INTO "JobTypeRegistry"/);
  for(const name of ['job_enqueue_v1','job_claim_v1','job_heartbeat_v1','job_finish_v1','job_reconcile_v1','record_job_fence_loss','authorized_job_v1']) assert.match(sql,new RegExp(`FUNCTION ${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  assert.match(sql,/CONSUMER_RECEIPT_DIGEST_CONFLICT/); assert.match(sql,/LEASE_FENCE_LOST/);
  assert.match(sql,/CHECK \(NOT "externalEffectCapable"\)/); assert.doesNotMatch(sql,/jobs\.retry|jobs\.resume/);
});

test('jobs HTTP list/detail always apply the identical no-store response boundary', async () => {
  const calls:string[]=[];const response={setHeader:(name:string,value:string)=>calls.push(`${name}:${value}`)};
  const reader={list:async()=>({items:[],asOfCreatedAt:new Date().toISOString(),allowedActions:[]}),detail:async()=>JOB_CONTRACT_FIXTURE_V1.detail};
  const controller=new JobsReaderController(reader as never);const request={user:{id:'viewer',sessionId:'session'},query:{},headers:{}} as never;
  await controller.list(request,{},response as never);await controller.detail(request,'00000000-0000-0000-0000-000000000000',response as never);
  assert.deepEqual(calls,['Cache-Control:no-store','Cache-Control:no-store']);
});
