export const ISSUE_CODES = ['ZERO_PROFILE', 'INCH_BASED_SIZE'] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
export type DetectedFormat = 'metric' | 'inch' | 'inch_with_zero_profile';

export interface AuditProduct {
  id: string;
  code: string;
  productType: string;
  vehicleClass: string;
  name: string;
  size: unknown;
  width: unknown;
  profile: unknown;
  rimDiameter: unknown;
  radius: unknown;
  application?: string | null;
  patternKey?: string | null;
  isPublished: boolean;
  brand: { name: string };
  tireModel?: { name: string } | null;
  sourceSize?: string | null;
}

export interface AuditRow {
  database_id: string;
  product_code: string;
  brand: string;
  model: string;
  product_name: string;
  category: string;
  current_full_size: string;
  current_width: unknown;
  current_profile: unknown;
  current_radius: string;
  issue_codes: IssueCode[];
  issue_description: string;
  detected_format: DetectedFormat;
  source_value: string;
  active_status: boolean;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * Detect an inch-width notation. Rim diameter is intentionally ignored: metric
 * catalog sizes also express the rim in inches (including 17.5/19.5/22.5).
 */
export function inchEvidence(product: AuditProduct): string[] {
  const evidence: string[] = [];
  const width = finiteNumber(product.width);
  if (width !== null && width > 0 && width < 100) evidence.push(`width=${width}`);

  const values = [
    ['size', asText(product.size)],
    ['name', product.name.trim()],
    ['import_size', product.sourceSize?.trim() ?? ''],
  ] as const;

  for (const [source, raw] of values) {
    if (!raw) continue;
    const value = raw.toUpperCase();
    const flotation = /(?:^|\s)\d{1,3}(?:\.\d+)?\s*[X×]\s*\d{1,2}(?:\.\d+)?\s*(?:R|-)?\s*\d{1,2}(?:\.5)?(?=\s|$)/.test(value);
    const inchR = /(?:^|\s)(?:\d{1,2}(?:\.\d+)?|\d{1,2}\/00)\s*R\s*\d{1,2}(?:\.5)?(?:C)?(?=\s|$)/.test(value);
    const inchAspect = /(?:^|\s)\d{1,2}(?:\.\d+)?\/\d{1,2}\s*R\s*\d{1,2}(?:\.5)?(?=\s|$)/.test(value);
    const industrial = /(?:^|\s)\d{1,2}(?:\.\d+)?\s*-\s*\d{1,2}(?:\.5)?(?=\s|$)/.test(value);
    if (flotation || inchR || inchAspect || industrial) evidence.push(`${source}=${raw}`);
  }
  return [...new Set(evidence)];
}

export function auditTireProducts(products: AuditProduct[]): AuditRow[] {
  const rows: AuditRow[] = [];
  for (const product of products) {
    if (product.productType !== 'tire') continue;
    const zeroProfile = product.profile === 0;
    const evidence = inchEvidence(product);
    const inchBased = evidence.length > 0;
    if (!zeroProfile && !inchBased) continue;

    const issueCodes: IssueCode[] = [];
    const descriptions: string[] = [];
    if (zeroProfile) {
      issueCodes.push('ZERO_PROFILE');
      descriptions.push('stored profile is exactly 0');
    }
    if (inchBased) {
      issueCodes.push('INCH_BASED_SIZE');
      descriptions.push('tire width or complete notation is inch-based rather than metric-width');
    }
    const category = `${product.productType}/${product.vehicleClass}/${product.application ?? ''}`;
    const sourceValue = [
      `size=${asText(product.size) || '(empty)'}`,
      `width=${String(product.width)}`,
      `profile=${String(product.profile)}`,
      `radius=${asText(product.radius) || '(empty)'}`,
      `name=${product.name}`,
      `category=${category}`,
      `import_size=${product.sourceSize?.trim() || '(unavailable)'}`,
      `inch_evidence=${evidence.join(' | ') || '(none)'}`,
    ].join('; ');

    rows.push({
      database_id: product.id,
      product_code: product.code,
      brand: product.brand.name,
      model: product.tireModel?.name ?? product.patternKey ?? '',
      product_name: product.name,
      category,
      current_full_size: asText(product.size),
      current_width: product.width,
      current_profile: product.profile,
      current_radius: asText(product.radius),
      issue_codes: issueCodes,
      issue_description: descriptions.join('; '),
      detected_format: zeroProfile && inchBased ? 'inch_with_zero_profile' : inchBased ? 'inch' : 'metric',
      source_value: sourceValue,
      active_status: product.isPublished,
    });
  }
  return rows.sort((a, b) => a.database_id.localeCompare(b.database_id, 'en'));
}
