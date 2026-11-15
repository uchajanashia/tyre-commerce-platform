import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { join } from 'node:path';

import { GovernanceController } from './governance.controller';

const root = join(__dirname, '..', '..');
const source = (relative: string) => readFileSync(join(root, relative), 'utf8');

describe('governance security remediation invariants', () => {
  it('takes mutation identity from the route and never accepts a client prepared object', async () => {
    const calls: unknown[][] = [];
    const approvals = { decide: async (...args: unknown[]) => { calls.push(args); return { state: 'pending' }; } };
    const controller = new GovernanceController({} as never, approvals as never);
    await controller.decide(
      { user: { id: 'actor' } } as never,
      'idempotency',
      'route-request-B',
      { value: 'approve', intentToken: 'selector.secret', stepUpToken: 'step-up' },
    );
    assert.equal(calls[0][1], 'route-request-B');
    assert.doesNotMatch(source('src/governance/governance.controller.ts'), /\bprepared\b/);
  });

  it('persists only the consumed database intent evidence', () => {
    const approval = source('src/governance/approval.service.ts');
    const policy = source('src/governance/policy-control.service.ts');
    assert.doesNotMatch(`${approval}\n${policy}`, /intentToken\.split|prepared\.intent/);
    assert.match(approval, /actionIntentId: consumedIntent\.id/);
    assert.match(policy, /actionIntentId: consumedIntent\.id/);
  });

  it('revalidates originating decision and review sessions', () => {
    const combined = `${source('src/governance/approval.service.ts')}\n${source('src/governance/policy-control.service.ts')}`;
    assert.match(combined, /actorSessionId/);
    assert.match(combined, /reviewerSessionId/);
    assert.match(combined, /idleExpiresAt > clock\.now/);
    assert.match(combined, /absoluteExpiresAt > clock\.now/);
    assert.match(combined, /DECISION_AUTHORIZATION_REVOKED/);
  });

  it('ships additive database admission and serialized range-overlap rejection', () => {
    const migration = source('prisma/migrations/20260730233000_governance_admission_hardening/migration.sql');
    assert.match(migration, /POLICY_MATERIALIZATION_ADMISSION_DENIED/);
    assert.match(migration, /POLICY_REVIEW_EVIDENCE_NO_LONGER_EFFECTIVE/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /ACTIVE_POLICY_SCHEMA_RANGE_OVERLAP/);
  });
});
