export const SIZE_SYSTEMS = ['metric', 'inch'] as const;

export type TireSizeSystem = (typeof SIZE_SYSTEMS)[number];

export interface TireSizeSystemSource {
  productType: 'tire' | 'disk';
  width: number;
}

/**
 * Metric catalog widths are millimetres. Every current inch-based tire and
 * truck disk has a section/rim width below 100, so the distinction is explicit
 * and does not depend on a fragile collection of size-string regular expressions.
 */
export function deriveSizeSystem(product: TireSizeSystemSource): TireSizeSystem {
  return product.productType === 'disk' || product.width < 100 ? 'inch' : 'metric';
}

/** Business invariant: inch-based tires never belong to the passenger journey. */
export function isValidSizeClass(
  productType: 'tire' | 'disk',
  vehicleClass: 'passenger' | 'truck',
  sizeSystem: TireSizeSystem,
): boolean {
  return productType === 'disk' || sizeSystem === 'metric' || vehicleClass === 'truck';
}
