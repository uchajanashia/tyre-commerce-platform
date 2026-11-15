import type { StockStatus } from '@prisma/client';

/**
 * Keeps exact inventory and the internal status consistent. An exact count, if
 * present, wins. With no count, the explicitly stored status remains valid.
 */
export function stockStatusForQuantity(
  stockQty: number | null,
  storedStatus: StockStatus,
): StockStatus {
  if (stockQty === null) return storedStatus;
  return stockQty >= 1 ? 'in_stock' : 'out_of_stock';
}
