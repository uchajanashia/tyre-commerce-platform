import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { auditTireProducts, inchEvidence, type AuditProduct } from './tire-size-audit';

function product(overrides: Partial<AuditProduct> = {}): AuditProduct {
  return {
    id: '1', code: 'SKU-1', productType: 'tire', vehicleClass: 'passenger',
    name: 'Tire 175/70R13 MODEL-BRAND', size: '175/70R13', width: 175,
    profile: 70, rimDiameter: 13, radius: 'R-13', application: 'passenger',
    patternKey: 'BRAND MODEL', isPublished: true, brand: { name: 'BRAND' },
    tireModel: { name: 'MODEL' }, sourceSize: '175/70R13', ...overrides,
  };
}

describe('narrow tire-size audit', () => {
  it('flags only exact numeric profile zero, not null or string zero', () => {
    const rows = auditTireProducts([
      product({ id: 'zero', code: 'zero', profile: 0 }),
      product({ id: 'null', code: 'null', size: '155R12C', name: 'Tire 155R12C', sourceSize: '155R12C', width: 155, profile: null, rimDiameter: 12, radius: 'R-12C' }),
      product({ id: 'string', code: 'string', profile: '0' }),
    ]);
    assert.deepEqual(rows.map((row) => row.database_id), ['zero']);
    assert.deepEqual(rows[0].issue_codes, ['ZERO_PROFILE']);
    assert.equal(rows[0].detected_format, 'metric');
  });

  it('detects every requested inch-notation family', () => {
    const sizes = [
      '12.5/80R18', '12.00R20', '12/00R20', '13.0000R22.5', '13/00R22.5',
      '9.5R17.5', '6.50R16', '7.00R16', '7/00R16', '7.50R16', '8.25R16',
      '31x10.5R15', '33x12.5R17', '35x12.50R20', '10-16.5', '33x15.50-16.5',
      '26.5-25', '11.00-20', '18.4-26', '18x7-8', '8.25-15', '7.00-9',
    ];
    for (const size of sizes) {
      const row = auditTireProducts([product({ size, name: `Tire ${size}`, sourceSize: size })])[0];
      assert.ok(row, `${size} should be reported`);
      assert.ok(row.issue_codes.includes('INCH_BASED_SIZE'), `${size} should be inch-based`);
    }
  });

  it('uses a decimal database width below 100 even when size text is unavailable', () => {
    const candidate = product({ size: '', name: 'unknown tire', sourceSize: null, width: 8.25, profile: null });
    assert.deepEqual(inchEvidence(candidate), ['width=8.25']);
    assert.deepEqual(auditTireProducts([candidate])[0].issue_codes, ['INCH_BASED_SIZE']);
  });

  it('does not confuse metric width with fractional rim, C suffix, large width, or null profile', () => {
    const valid = [
      ['315/80R22.5', 315, 80],
      ['385/65R22.5', 385, 65],
      ['225/75R17.5', 225, 75],
      ['205/65R16C', 205, 65],
      ['155R12C', 155, null],
    ] as const;
    for (const [size, width, profile] of valid) {
      const rows = auditTireProducts([product({ size, name: `Tire ${size}`, sourceSize: size, width, profile })]);
      assert.equal(rows.length, 0, `${size} must not be reported`);
    }
  });

  it('combines overlapping zero-profile and inch-size findings in one row', () => {
    const row = auditTireProducts([product({ size: '12/00R20', name: 'Tire 12/00R20', sourceSize: '12/00R20', width: 12, profile: 0, rimDiameter: 20, radius: 'R-20' })])[0];
    assert.deepEqual(row.issue_codes, ['ZERO_PROFILE', 'INCH_BASED_SIZE']);
    assert.equal(row.detected_format, 'inch_with_zero_profile');
  });

  it('ignores non-tire products', () => {
    assert.equal(auditTireProducts([product({ productType: 'disk', width: 7, profile: 0 })]).length, 0);
  });
});
