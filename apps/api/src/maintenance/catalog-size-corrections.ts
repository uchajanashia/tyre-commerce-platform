import { composeProductSlug, composeRadius } from '../common/product-compose.util';
import { brandSlug } from '../common/slug.util';

export interface MetricSizeCorrection {
  oldSize: string;
  size: string;
  width: number;
  profile: number;
  rimDiameter: number;
}

/** Values written in parentheses in შესწორება.xlsx / "მიმდინარე ზომა". */
export const METRIC_SIZE_CORRECTIONS: Readonly<Record<string, MetricSizeCorrection>> = {
  '002349': { oldSize: '31x10.5R15', size: '265/70R15', width: 265, profile: 70, rimDiameter: 15 },
  '002413': { oldSize: '31x10.5R15', size: '265/70R15', width: 265, profile: 70, rimDiameter: 15 },
  '003019': { oldSize: '33X12.5R17', size: '315/65R17', width: 315, profile: 65, rimDiameter: 17 },
  '003460': { oldSize: '31x10.5R15', size: '265/70R15', width: 265, profile: 70, rimDiameter: 15 },
  '003463': { oldSize: '33x12.5R15', size: '315/70R15', width: 315, profile: 70, rimDiameter: 15 },
  '003464': { oldSize: '35x12.5R15', size: '315/80R15', width: 315, profile: 80, rimDiameter: 15 },
  '003468': { oldSize: '35x12.5R17', size: '315/75R17', width: 315, profile: 75, rimDiameter: 17 },
  '003957': { oldSize: '33x12.5R18', size: '315/60R18', width: 315, profile: 60, rimDiameter: 18 },
  '004091': { oldSize: '35x12.50R18', size: '315/70R18', width: 315, profile: 70, rimDiameter: 18 },
  '004588': { oldSize: '35x12.50R20', size: '315/60R20', width: 315, profile: 60, rimDiameter: 20 },
  '004703': { oldSize: '35X12.50R16', size: '315/75R16', width: 315, profile: 75, rimDiameter: 16 },
};

interface RawCatalogProduct {
  code: string;
  slug: string;
  brand: string;
  productType: string;
  vehicleClass: string;
  vehicleClassLabel?: string;
  name: string;
  size: string;
  width: number;
  profile: number | null;
  rimDiameter: number;
  radius: string;
}

/**
 * Overlay the reviewed workbook on the immutable supplier export. Seed imports
 * remain idempotent without rewriting the historical wheels_catalog.json file.
 */
export function applyCatalogSizeCorrection<T extends RawCatalogProduct>(product: T): T {
  const next = { ...product };
  const originalSize = next.size;
  const metric = METRIC_SIZE_CORRECTIONS[next.code];

  if (metric) {
    if (originalSize !== metric.oldSize && originalSize !== metric.size) {
      throw new Error(
        `Correction source mismatch for ${next.code}: expected ${metric.oldSize}, got ${originalSize}`,
      );
    }
    next.size = metric.size;
    next.width = metric.width;
    next.profile = metric.profile;
    next.rimDiameter = metric.rimDiameter;
    next.radius = composeRadius(metric.rimDiameter, false);
  } else if (next.productType === 'tire' && next.size.includes('/00R')) {
    next.size = next.size.replace('/00R', '.00R');
    if (next.profile === 0) next.profile = null;
  }

  if (next.size !== originalSize) {
    next.slug = composeProductSlug(next.size, brandSlug(next.brand), next.code);
    next.name = next.name.replace(originalSize, next.size);
  }

  if (next.productType === 'tire' && next.width < 100 && next.vehicleClass === 'passenger') {
    next.vehicleClass = 'truck';
    next.vehicleClassLabel = 'სატვირთო';
  }

  return next;
}

export function correctedSourceSize(code: string, sourceSize: string | null): string | null {
  if (!sourceSize) return sourceSize;
  return METRIC_SIZE_CORRECTIONS[code]?.size ?? sourceSize.replace('/00R', '.00R');
}
