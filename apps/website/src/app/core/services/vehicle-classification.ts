import {
  classifyVehicleSize,
  EXACT_VEHICLE_CLASS_BY_SIZE,
  isPassengerVehicleClassification,
  isVehicleClassification,
  normalizeVehicleSize as normalizeSharedVehicleSize,
  PASSENGER_VEHICLE_CLASSIFICATIONS,
  resolveVehicleClass,
  type VehicleClassification,
  type PassengerVehicleClassification,
} from '@tyre/shared/vehicle-classification';

export {
  EXACT_VEHICLE_CLASS_BY_SIZE,
  isPassengerVehicleClassification,
  isVehicleClassification,
  PASSENGER_VEHICLE_CLASSIFICATIONS as VEHICLE_CLASSIFICATIONS,
  resolveVehicleClass,
};
export type {
  PassengerVehicleClassification,
  VehicleClassification,
} from '@tyre/shared/vehicle-classification';

export interface VehicleClassificationResult {
  primary: VehicleClassification;
  alternatives: VehicleClassification[];
}

export interface VehicleSizeInput {
  width: unknown;
  profile: unknown;
  radius: unknown;
  classification?: unknown;
}

export function getVehicleImage(classification: VehicleClassification): string {
  return `/new_image/${classification}.webp`;
}

const CATEGORY_IMAGE_FALLBACK: Partial<Record<VehicleClassification, VehicleClassification>> = {
  'vehicle-wrangler': 'vehicle-offroad',
  'vehicle-small-cargo-van': 'vehicle-minivan',
  'vehicle-premium-van': 'vehicle-minivan',
  'vehicle-electric-compact': 'vehicle-compact',
  'vehicle-range-rover': 'vehicle-luxury-suv',
  'vehicle-coupe-premium-suv': 'vehicle-premium-suv',
  'vehicle-large-premium-suv': 'vehicle-premium-suv',
  'vehicle-performance-car': 'vehicle-sport-sedan',
  'vehicle-sport-coupe': 'vehicle-sport-sedan',
};

export const NEUTRAL_VEHICLE_PLACEHOLDER =
  '/assets/vehicle-scenes/neutral-wheel-studio/neutral-wheel-studio-body.webp';

/** Ordered, finite image fallback chain. The neutral asset is last and is never
 * re-requested after it errors. */
export function getVehicleImageFallbackChain(classification: VehicleClassification): string[] {
  const category = CATEGORY_IMAGE_FALLBACK[classification] ?? 'vehicle-family-sedan';
  return [...new Set([
    getVehicleImage(classification),
    getVehicleImage(category),
    getVehicleImage('vehicle-family-sedan'),
    NEUTRAL_VEHICLE_PLACEHOLDER,
  ])];
}

export function normalizeVehicleSize(input: VehicleSizeInput): {
  width: number;
  profile: number;
  radius: number;
  commercial: boolean;
  key: string;
} | null {
  return normalizeSharedVehicleSize({
    width: input.width,
    profile: input.profile,
    radius: input.radius,
  });
}

/** Compatibility facade for existing components. The shared resolver is the
 * source of truth; this function can no longer return null for a tyre. */
export function classifyVehicle(input: VehicleSizeInput): VehicleClassificationResult {
  if (isVehicleClassification(input.classification)) {
    return { primary: input.classification, alternatives: [] };
  }
  const normalized = normalizeVehicleSize(input);
  if (normalized) {
    const sizeResolution = classifyVehicleSize(normalized);
    if (sizeResolution) {
      return { primary: sizeResolution.primary, alternatives: sizeResolution.alternatives };
    }
  }
  const resolved = resolveVehicleClass({
    productType: 'tire',
    vehicleClass: 'passenger',
    width: input.width,
    profile: input.profile,
    radius: input.radius,
  });
  return { primary: resolved.classification, alternatives: [] };
}

export function hasDirectPassengerVehicleAsset(
  classification: VehicleClassification,
): classification is PassengerVehicleClassification {
  return isPassengerVehicleClassification(classification)
    && PASSENGER_VEHICLE_CLASSIFICATIONS.includes(classification);
}
