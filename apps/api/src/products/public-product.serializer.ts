import type { StockStatus } from '@prisma/client';
import { resolveVehicleClass, type VehicleClassification, type VehicleResolverProduct } from '@tyre/shared';

import { stockStatusForQuantity } from '../common/inventory.util';

export type PublicAvailability = 'in_stock' | 'out_of_stock';

type PrivateInventoryFields = {
  stockQty: number | null;
  reservedQty?: number;
  stockStatus: StockStatus;
};

export type PublicProductSource = PrivateInventoryFields & {
  tireModel?: { photos: { url: string }[] } | null;
  id?: string;
  code?: string;
} & VehicleResolverProduct;

/**
 * Exact inventory is authoritative when it exists. Imported products currently
 * have no exact count, so their explicitly stored stock status remains the
 * source of truth until stockQty is supplied by inventory/admin.
 */
export function toPublicAvailability(
  stockQty: number | null,
  stockStatus: StockStatus,
): PublicAvailability {
  return stockStatusForQuantity(stockQty, stockStatus) === 'out_of_stock'
    ? 'out_of_stock'
    : 'in_stock';
}

/**
 * Creates the anonymous storefront wire shape. The destructuring is a privacy
 * boundary: neither exact quantity nor the internal three-state stock status
 * can be returned accidentally by a controller.
 */
export function serializePublicProduct<T extends PublicProductSource>(
  product: T,
  publicPhotoUrl: (storedUrl: string) => string,
): Omit<T, 'tireModel' | 'stockQty' | 'stockStatus' | 'reservedQty'> & {
  availability: PublicAvailability;
  photos: string[];
  vehicleClassification: VehicleClassification;
} {
  const { tireModel, stockQty, stockStatus, reservedQty, ...publicFields } = product;
  const vehicle = resolveVehicleClass(product);
  if (vehicle.usedAbsoluteFallback && process.env['NODE_ENV'] !== 'production') {
    console.warn(
      `[vehicle-classification] absolute fallback for product ${product.code ?? product.id ?? 'unknown'} (${String(product.size ?? 'unknown size')})`,
    );
  }

  return {
    ...publicFields,
    vehicleClassification: vehicle.classification,
    availability: toPublicAvailability(stockQty === null ? (process.env.OPERATIONS_WORKFLOWS_ENABLED === "true" ? 0 : null) : Math.max(0, stockQty - (reservedQty ?? 0)), stockStatus),
    photos: (tireModel?.photos ?? []).map((photo) => publicPhotoUrl(photo.url)),
  };
}
