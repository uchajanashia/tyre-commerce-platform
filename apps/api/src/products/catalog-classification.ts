import type { Prisma } from '@prisma/client';

export const CATALOG_CLASSES = ['passenger', 'truck', 'special', 'disk'] as const;

export type CatalogClass = (typeof CATALOG_CLASSES)[number];

export interface CatalogClassSource {
  productType: 'tire' | 'disk';
  vehicleClass: 'passenger' | 'truck';
  sizeSystem: 'metric' | 'inch';
  application: string;
}

/**
 * Storefront classification derived only from fields present in the customer
 * catalog. `special` is backed by the source application's explicit
 * "სპეცტექნიკა/" prefix; disks always win over the legacy
 * passenger/truck field. No missing or unknown value is guessed here.
 */
export function deriveCatalogClass(product: CatalogClassSource): CatalogClass {
  if (product.productType === 'disk') {
    return 'disk';
  }
  if (product.application.startsWith('სპეცტექნიკა/')) {
    return 'special';
  }
  if (product.sizeSystem === 'inch') {
    return 'truck';
  }
  return product.vehicleClass;
}

/** Database predicate mirroring deriveCatalogClass exactly. */
export function catalogClassWhere(catalogClass: CatalogClass): Prisma.ProductWhereInput {
  switch (catalogClass) {
    case 'passenger':
      return { productType: 'tire', vehicleClass: 'passenger', sizeSystem: 'metric' };
    case 'truck':
      return {
        productType: 'tire',
        application: { not: { startsWith: 'სპეცტექნიკა/' } },
        OR: [{ vehicleClass: 'truck' }, { sizeSystem: 'inch' }],
      };
    case 'special':
      return { productType: 'tire', application: { startsWith: 'სპეცტექნიკა/' } };
    case 'disk':
      return { productType: 'disk' };
  }
}
