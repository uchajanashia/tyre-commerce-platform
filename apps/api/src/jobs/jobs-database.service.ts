import { createHash, createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { JOBS_CONFIG, JobsConfig } from './jobs.config';

export type JobPurpose = 'producer'|'claimer'|'reader'|'maintenance';
export type RestrictedJobTransaction = Pick<Prisma.TransactionClient,'$queryRaw'|'$queryRawUnsafe'>;

interface RuntimeAttestation { databaseLogin:string; databaseGroup:string; membershipValid:boolean; boundaryValid:boolean; runtimeContractDigest:string; registryDigest:string; operationalPolicyDigest:string; boundaryDigest:string; guardCanLogin:boolean; }
interface KeyAttestation { keyDigest:string; maxContextTtlSeconds:number; runtimeContractDigest:string; registryDigest:string; operationalPolicyDigest:string; runtimeLogin:string; principalId:string; boundaryDigest:string; boundaryValid:boolean; }

const GROUP: Record<JobPurpose,string> = {producer:'tyre_jobs_producer',claimer:'tyre_jobs_claimer',reader:'tyre_jobs_reader',maintenance:'tyre_jobs_maintenance'};

function signaturePayload(purpose:string,login:string,keyId:string,viewerId:string,sessionId:string,operationDigest:string,issuedAt:number,expiresAt:number,nonce:string,challenge:string,challengeTxid:bigint):string {
  return ['tyre.jobs.db-context.v1',purpose,login,keyId,viewerId,sessionId,operationDigest,String(issuedAt),String(expiresAt),nonce,challenge,String(challengeTxid)].join('\n');
}

@Injectable()
export class JobsDatabaseService implements OnModuleInit,OnModuleDestroy {
  private readonly clients = new Map<JobPurpose,PrismaClient>();
  constructor(@Inject(JOBS_CONFIG) private readonly config:JobsConfig) {}

  async onModuleInit():Promise<void> {
    if(!this.config.enabled) return;
    for(const purpose of ['producer','claimer','reader','maintenance'] as const) this.clients.set(purpose,new PrismaClient({datasourceUrl:this.config.databaseUrls![purpose]}));
    try { await Promise.all([...this.clients.values()].map(client=>client.$connect())); for(const purpose of ['producer','claimer','reader','maintenance'] as const) await this.attest(purpose); }
    catch(error){await this.onModuleDestroy();this.clients.clear();throw error;}
  }
  async onModuleDestroy():Promise<void>{await Promise.all([...this.clients.values()].map(client=>client.$disconnect()));}

  async withReaderContext<T>(identity:{id:string;sessionId:string},operation:(tx:RestrictedJobTransaction)=>Promise<T>):Promise<T>{
    return this.withContext('reader',identity,'authorized_job',{viewerId:identity.id,sessionId:identity.sessionId},operation);
  }

  async withContext<T>(purpose:Exclude<JobPurpose,'maintenance'>,identity:{id:string;sessionId:string},operationName:string,operationArguments:unknown,operation:(tx:RestrictedJobTransaction)=>Promise<T>):Promise<T>{
    const client=this.clients.get(purpose); if(!client||!this.config.enabled) throw new Error('JOBS_DATABASE_DISABLED');
    return client.$transaction(async tx=>{
      const [digestRow]=await tx.$queryRawUnsafe<Array<{digest:string}>>('SELECT job_operation_digest_v1($1,$2::jsonb) AS digest',operationName,JSON.stringify(operationArguments));
      if(!digestRow?.digest) throw new Error('JOBS_OPERATION_DIGEST_FAILED');
      if(!await this.bind(tx,purpose,identity,digestRow.digest)) throw new Error('JOBS_DB_CONTEXT_INVALID');
      return operation(tx);
    });
  }

  private async bind(tx:RestrictedJobTransaction,purpose:Exclude<JobPurpose,'maintenance'>,identity:{id:string;sessionId:string},operationDigest:string):Promise<boolean>{
    const key=this.config.runtimeContextKeys![purpose]; const login=this.config.databaseRoles![purpose];
    const actor=purpose==='reader'?identity:{id:login,sessionId:'runtime'};
    const [challenge]=await tx.$queryRawUnsafe<Array<{challenge:string;challengeTxid:bigint}>>(`SELECT challenge,challenge_txid AS "challengeTxid" FROM job_${purpose}_issue_challenge_v1($1,$2)`,key.id,operationDigest);
    if(!challenge) return false; const issuedAt=Date.now(),expiresAt=issuedAt+key.ttlSeconds*1000,nonce=randomBytes(16).toString('base64url');
    const signature=createHmac('sha256',key.material).update(signaturePayload(purpose,login,key.id,actor.id,actor.sessionId,operationDigest,issuedAt,expiresAt,nonce,challenge.challenge,challenge.challengeTxid),'utf8').digest('base64url');
    const [row]=await tx.$queryRawUnsafe<Array<{bound:boolean}>>(`SELECT job_${purpose}_bind_context_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS bound`,key.id,actor.id,actor.sessionId,operationDigest,issuedAt,expiresAt,nonce,signature,challenge.challenge,challenge.challengeTxid);
    return row?.bound===true;
  }

  private async attest(purpose:JobPurpose):Promise<void>{
    const client=this.clients.get(purpose)!; const expectedLogin=this.config.databaseRoles![purpose];
    const [role]=await client.$queryRawUnsafe<Array<{login:string;superuser:boolean;createRole:boolean;createDb:boolean;inheritRole:boolean;bypassRls:boolean;guardMember:boolean;rawJob:boolean;crossPurpose:boolean}>>(`SELECT current_user::text AS login,r.rolsuper AS superuser,r.rolcreaterole AS "createRole",r.rolcreatedb AS "createDb",r.rolinherit AS "inheritRole",r.rolbypassrls AS "bypassRls",pg_has_role(current_user,'tyre_jobs_guard_owner','member') AS "guardMember",has_table_privilege(current_user,'public."BackgroundJob"','SELECT,INSERT,UPDATE,DELETE') AS "rawJob",has_function_privilege(current_user,'public.job_enqueue_v1(text,integer,jsonb,integer,timestamp with time zone,text,jsonb,text,text,uuid)','EXECUTE') AND $1<>'producer' AS "crossPurpose" FROM pg_roles r WHERE r.rolname=current_user`,purpose);
    if(!role||role.login!==expectedLogin||role.superuser||role.createRole||role.createDb||!role.inheritRole||role.bypassRls||role.guardMember||role.rawJob||role.crossPurpose) throw new Error(`JOBS_${purpose.toUpperCase()}_ROLE_ATTESTATION_FAILED`);
    const [boundary]=await client.$queryRawUnsafe<RuntimeAttestation[]>('SELECT database_login AS "databaseLogin",database_group AS "databaseGroup",membership_valid AS "membershipValid",boundary_valid AS "boundaryValid",runtime_contract_digest AS "runtimeContractDigest",registry_digest AS "registryDigest",operational_policy_digest AS "operationalPolicyDigest",boundary_digest AS "boundaryDigest",guard_can_login AS "guardCanLogin" FROM job_runtime_attestation_v4($1::name)',GROUP[purpose]);
    if(!boundary||boundary.databaseLogin!==expectedLogin||boundary.databaseGroup!==GROUP[purpose]||!boundary.membershipValid||!boundary.boundaryValid||boundary.runtimeContractDigest!==this.config.runtimeContractDigest||boundary.registryDigest!==this.config.registryDigest||boundary.operationalPolicyDigest!==this.config.operationalPolicyDigest||boundary.boundaryDigest!==this.config.boundaryDigests![purpose]||boundary.guardCanLogin) throw new Error(`JOBS_${purpose.toUpperCase()}_BOUNDARY_ATTESTATION_FAILED`);
    if(purpose!=='maintenance'){
      const key=this.config.runtimeContextKeys![purpose]; const [contract]=await client.$queryRawUnsafe<KeyAttestation[]>('SELECT key_digest AS "keyDigest",max_context_ttl_seconds AS "maxContextTtlSeconds",runtime_contract_digest AS "runtimeContractDigest",registry_digest AS "registryDigest",operational_policy_digest AS "operationalPolicyDigest" FROM job_runtime_key_attestation_v1($1,$2)',purpose,key.id);
      const [hardened]=await client.$queryRawUnsafe<KeyAttestation[]>('SELECT key_digest AS "keyDigest",max_context_ttl_seconds AS "maxContextTtlSeconds",runtime_contract_digest AS "runtimeContractDigest",registry_digest AS "registryDigest",operational_policy_digest AS "operationalPolicyDigest",runtime_login AS "runtimeLogin",principal_id AS "principalId",boundary_digest AS "boundaryDigest",boundary_valid AS "boundaryValid" FROM job_runtime_key_attestation_v4($1,$2)',purpose,key.id);
      if(!contract||!hardened||hardened.keyDigest!==createHash('sha256').update(key.material).digest('base64url')||hardened.maxContextTtlSeconds!==key.ttlSeconds||hardened.runtimeContractDigest!==this.config.runtimeContractDigest||hardened.registryDigest!==this.config.registryDigest||hardened.operationalPolicyDigest!==this.config.operationalPolicyDigest||hardened.runtimeLogin!==expectedLogin||hardened.principalId!==key.principalId||hardened.boundaryDigest!==this.config.boundaryDigests![purpose]||!hardened.boundaryValid) throw new Error(`JOBS_${purpose.toUpperCase()}_KEY_ATTESTATION_FAILED`);
    }
  }
}
