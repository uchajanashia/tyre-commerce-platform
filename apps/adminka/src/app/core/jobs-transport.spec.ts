import { JOB_CONTRACT_FIXTURE_V1 } from '@tyre/shared';

import { decodeJobDetail, decodeJobList } from './jobs-transport';

describe('strict Jobs transport', () => {
  it('decodes the shared executable list and detail fixtures without changing the wire shape', () => {
    expect(decodeJobList(JOB_CONTRACT_FIXTURE_V1.listPage)).toEqual(
      JOB_CONTRACT_FIXTURE_V1.listPage,
    );
    expect(decodeJobDetail(JOB_CONTRACT_FIXTURE_V1.detail)).toEqual(JOB_CONTRACT_FIXTURE_V1.detail);
    expect(JOB_CONTRACT_FIXTURE_V1.detail.allowedActions).toEqual([]);
  });

  it.each([
    ['unknown list key', { ...JOB_CONTRACT_FIXTURE_V1.listPage, rawPayload: '{}' }, decodeJobList],
    [
      'non-empty actions',
      { ...JOB_CONTRACT_FIXTURE_V1.detail, allowedActions: ['retry'] },
      decodeJobDetail,
    ],
    ['unknown status', { ...JOB_CONTRACT_FIXTURE_V1.detail, state: 'retrying' }, decodeJobDetail],
    [
      'unsafe summary value',
      {
        ...JOB_CONTRACT_FIXTURE_V1.detail,
        safeSummary: [{ ...JOB_CONTRACT_FIXTURE_V1.detail.safeSummary[0], value: { raw: true } }],
      },
      decodeJobDetail,
    ],
    [
      'attempt contract drift',
      {
        ...JOB_CONTRACT_FIXTURE_V1.detail,
        attempts: [{ ...JOB_CONTRACT_FIXTURE_V1.detail.attempts[0], leaseSecret: 'forbidden' }],
      },
      decodeJobDetail,
    ],
  ])('fails closed on %s', (_label, wire, decoder) => {
    expect(() => decoder(wire)).toThrowError('JOBS_CONTRACT_DRIFT');
  });
});
