import { AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1 } from '@tyre/shared';

import { decodeAuditEventDetail, decodeAuditEventList } from './audit-transport';

describe('audit shared transport boundary', () => {
  it('accepts list and detail fixtures authored against the shared contract', () => {
    const { listPage: list, detail } = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1;
    expect(decodeAuditEventList(list)).toEqual(list);
    expect(decodeAuditEventDetail(detail)).toEqual(detail);
    expect(Object.isFrozen(AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1)).toBe(true);
    expect(Object.isFrozen(detail.metadata)).toBe(true);
  });

  it.each([
    { items: [], nextCursor: null, previousCursor: null },
    { items: [], asOfOccurredAt: '2026-07-30T00:00:00.000Z', allowedActions: [], extra: true },
    { items: [], asOfOccurredAt: '2026-07-30T00:00:00.000Z', allowedActions: ['export'] },
  ])('rejects list contract drift without adapting unknown fields', (wire) => {
    expect(() => decodeAuditEventList(wire)).toThrowError('AUDIT_CONTRACT_DRIFT');
  });

  it('rejects old classification spellings in otherwise-shaped detail evidence', () => {
    const detail = AUDIT_EVENT_V2_CONTRACT_FIXTURE_V1.detail;
    const drifted = {
      ...detail,
      metadata: [
        { key: 'channel', label: 'Channel', classification: 'operational', value: 'admin' },
      ],
    };
    expect(() => decodeAuditEventDetail(drifted)).toThrowError('AUDIT_CONTRACT_DRIFT');
  });
});
