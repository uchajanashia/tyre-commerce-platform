import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const SCOPE_TYPES = ["global", "warehouse", "channel", "company"] as const;
const PRODUCT_TYPES = ["tire", "disk"] as const;
const VEHICLE_CLASSES = ["passenger", "truck"] as const;
const SIZE_SYSTEMS = ["metric", "inch"] as const;
const CONSTRUCTIONS = ["radial", "bias"] as const;
const SEASON_GROUPS = ["summer", "all_season", "winter"] as const;
const STOCK_STATUSES = ["in_stock", "limited", "out_of_stock"] as const;
const CATALOG_CLASSES = ["passenger", "truck", "special", "disk"] as const;
const AVAILABILITY = ["in_stock", "out_of_stock"] as const;
const QUOTE_ISSUES = [
  "not_found",
  "out_of_stock",
  "insufficient_quantity",
] as const;
const VEHICLE_CLASSIFICATIONS = [
  "vehicle-city-car",
  "vehicle-prius",
  "vehicle-compact",
  "vehicle-compact-sedan",
  "vehicle-sport-sedan",
  "vehicle-family-sedan",
  "vehicle-business-sedan",
  "vehicle-luxury-sedan",
  "vehicle-sport-coupe",
  "vehicle-performance-car",
  "vehicle-small-crossover",
  "vehicle-compact-crossover",
  "vehicle-popular-crossover",
  "vehicle-premium-crossover",
  "vehicle-coupe-suv",
  "vehicle-premium-suv",
  "vehicle-large-premium-suv",
  "vehicle-coupe-premium-suv",
  "vehicle-luxury-suv",
  "vehicle-range-rover",
  "vehicle-offroad-luxury",
  "vehicle-offroad",
  "vehicle-pickup",
  "vehicle-minivan",
  "vehicle-wrangler",
  "vehicle-small-cargo-van",
  "vehicle-premium-van",
  "vehicle-electric-compact",
  "vehicle-cargo-van",
  "vehicle-suv-4x4",
  "vehicle-highway-truck",
  "vehicle-quarry-dump",
  "vehicle-backhoe",
  "vehicle-wheel-loader",
  "vehicle-skid-steer",
  "vehicle-forklift",
] as const;

export class DeletedResponseDto {
  @ApiProperty({ enum: [true] })
  deleted!: true;
}

export class RevokedResponseDto {
  @ApiProperty({ enum: [true] })
  revoked!: true;
}

export class PermissionGrantResponseDto {
  @ApiProperty() permission!: string;
  @ApiProperty({ enum: SCOPE_TYPES }) scopeType!: (typeof SCOPE_TYPES)[number];
  @ApiProperty() scopeId!: string;
}

export class LegacyAdminResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "email" }) email!: string;
  @ApiProperty() role!: string;
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ type: String, isArray: true }) permissions!: string[];
  @ApiProperty({ type: () => PermissionGrantResponseDto, isArray: true })
  permissionGrants!: PermissionGrantResponseDto[];
}

export class LegacyLoginResponseDto {
  @ApiProperty({ readOnly: true }) accessToken!: string;
  @ApiProperty({ type: () => LegacyAdminResponseDto })
  admin!: LegacyAdminResponseDto;
}

export class PublicBrandResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: String, nullable: true }) defaultCountry!: string | null;
  @ApiProperty({ minimum: 0 }) productCount!: number;
}

export class AdminBrandResponseDto extends PublicBrandResponseDto {
  @ApiProperty({ minimum: 0 }) tireModelCount!: number;
}

export class BrandReferenceResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class AdminPhotoResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: "uri" }) url!: string;
  @ApiProperty({ minimum: 0 }) position!: number;
}

export class AdminProductResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: PRODUCT_TYPES })
  productType!: (typeof PRODUCT_TYPES)[number];
  @ApiProperty({ enum: VEHICLE_CLASSES })
  vehicleClass!: (typeof VEHICLE_CLASSES)[number];
  @ApiProperty({ type: String, nullable: true })
  vehicleClassification!: string | null;
  @ApiProperty({ enum: SIZE_SYSTEMS })
  sizeSystem!: (typeof SIZE_SYSTEMS)[number];
  @ApiProperty() brandId!: string;
  @ApiProperty() patternKey!: string;
  @ApiProperty() tireModelId!: string;
  @ApiProperty() size!: string;
  @ApiProperty() width!: number;
  @ApiProperty({ type: Number, nullable: true }) profile!: number | null;
  @ApiProperty() rimDiameter!: number;
  @ApiProperty() radius!: string;
  @ApiProperty({ enum: CONSTRUCTIONS })
  construction!: (typeof CONSTRUCTIONS)[number];
  @ApiProperty() commercial!: boolean;
  @ApiProperty({ type: Number, nullable: true })
  overallDiameter!: number | null;
  @ApiProperty({ type: String, nullable: true }) loadSpeedIndex!: string | null;
  @ApiProperty({ type: String, nullable: true }) plyRating!: string | null;
  @ApiProperty({ type: String, nullable: true }) treadType!: string | null;
  @ApiProperty() application!: string;
  @ApiProperty({ type: String, nullable: true }) season!: string | null;
  @ApiProperty({
    oneOf: [{ type: "string", enum: [...SEASON_GROUPS] }, { type: "null" }],
  })
  seasonGroup!: (typeof SEASON_GROUPS)[number] | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty() unit!: string;
  @ApiProperty({ minimum: 0 }) retailPrice!: number;
  @ApiProperty({ minimum: 0 }) wholesalePrice!: number;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: STOCK_STATUSES })
  stockStatus!: (typeof STOCK_STATUSES)[number];
  @ApiProperty({ type: Number, nullable: true, minimum: 0 })
  stockQty!: number | null;
  @ApiProperty() name!: string;
  @ApiProperty() isPublished!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
}

export class AdminTireModelListItemResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: () => BrandReferenceResponseDto })
  brand!: BrandReferenceResponseDto;
  @ApiProperty({ minimum: 0 }) productCount!: number;
  @ApiProperty({ minimum: 0 }) photoCount!: number;
}

export class AdminTireModelListResponseDto {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1 }) pageSize!: number;
  @ApiProperty({ type: () => AdminTireModelListItemResponseDto, isArray: true })
  items!: AdminTireModelListItemResponseDto[];
}

export class AdminTireModelDetailResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ type: () => BrandReferenceResponseDto })
  brand!: BrandReferenceResponseDto;
  @ApiProperty({ minimum: 0 }) photoCount!: number;
  @ApiProperty({ type: () => AdminPhotoResponseDto, isArray: true })
  photos!: AdminPhotoResponseDto[];
  @ApiProperty({ type: () => AdminProductResponseDto, isArray: true })
  products!: AdminProductResponseDto[];
}

export class PublicProductBrandResponseDto extends BrandReferenceResponseDto {
  @ApiProperty({ type: String, nullable: true }) defaultCountry!: string | null;
}

export class PublicProductResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() code!: string;
  @ApiProperty() slug!: string;
  @ApiProperty({ enum: PRODUCT_TYPES })
  productType!: (typeof PRODUCT_TYPES)[number];
  @ApiProperty({ enum: VEHICLE_CLASSES })
  vehicleClass!: (typeof VEHICLE_CLASSES)[number];
  @ApiProperty({ enum: VEHICLE_CLASSIFICATIONS })
  vehicleClassification!: (typeof VEHICLE_CLASSIFICATIONS)[number];
  @ApiProperty({ enum: CATALOG_CLASSES })
  catalogClass!: (typeof CATALOG_CLASSES)[number];
  @ApiProperty({ enum: SIZE_SYSTEMS })
  sizeSystem!: (typeof SIZE_SYSTEMS)[number];
  @ApiProperty() brandId!: string;
  @ApiProperty() patternKey!: string;
  @ApiProperty() size!: string;
  @ApiProperty() width!: number;
  @ApiProperty({ type: Number, nullable: true }) profile!: number | null;
  @ApiProperty() rimDiameter!: number;
  @ApiProperty() radius!: string;
  @ApiProperty({ enum: CONSTRUCTIONS })
  construction!: (typeof CONSTRUCTIONS)[number];
  @ApiProperty() commercial!: boolean;
  @ApiProperty({ type: Number, nullable: true })
  overallDiameter!: number | null;
  @ApiProperty({ type: String, nullable: true }) loadSpeedIndex!: string | null;
  @ApiProperty({ type: String, nullable: true }) plyRating!: string | null;
  @ApiProperty({ type: String, nullable: true }) treadType!: string | null;
  @ApiProperty() application!: string;
  @ApiProperty({ type: String, nullable: true }) season!: string | null;
  @ApiProperty({
    oneOf: [{ type: "string", enum: [...SEASON_GROUPS] }, { type: "null" }],
  })
  seasonGroup!: (typeof SEASON_GROUPS)[number] | null;
  @ApiProperty({ type: String, nullable: true }) country!: string | null;
  @ApiProperty() unit!: string;
  @ApiProperty({ minimum: 0 }) retailPrice!: number;
  @ApiProperty() currency!: string;
  @ApiProperty() name!: string;
  @ApiProperty() isPublished!: boolean;
  @ApiProperty({ format: "date-time" }) createdAt!: string;
  @ApiProperty({ format: "date-time" }) updatedAt!: string;
  @ApiProperty({ type: () => PublicProductBrandResponseDto })
  brand!: PublicProductBrandResponseDto;
  @ApiProperty({ enum: AVAILABILITY })
  availability!: (typeof AVAILABILITY)[number];
  @ApiProperty({ type: String, isArray: true }) photos!: string[];
}

export class PublicProductListResponseDto {
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ minimum: 1 }) pageSize!: number;
  @ApiProperty({ type: () => PublicProductResponseDto, isArray: true })
  items!: PublicProductResponseDto[];
}

export class ProductSizeFacetsResponseDto {
  @ApiProperty({ type: Number, isArray: true }) widths!: number[];
  @ApiProperty({ type: Number, isArray: true }) profiles!: number[];
  @ApiProperty({ type: Number, isArray: true }) diameters!: number[];
  @ApiProperty({ type: String, isArray: true }) inchSizes!: string[];
}

export class CartQuoteItemResponseDto {
  @ApiProperty() productId!: string;
  @ApiProperty({ type: String, nullable: true }) code!: string | null;
  @ApiProperty({ type: String, nullable: true }) name!: string | null;
  @ApiProperty({ minimum: 1, maximum: 4 }) quantity!: number;
  @ApiProperty() available!: boolean;
  @ApiProperty({
    oneOf: [{ type: "string", enum: [...QUOTE_ISSUES] }, { type: "null" }],
  })
  issue!: (typeof QUOTE_ISSUES)[number] | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 }) unitPrice!:
    | number
    | null;
  @ApiProperty({ type: Number, nullable: true, minimum: 0 }) lineTotal!:
    | number
    | null;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
}

export class CartQuoteResponseDto {
  @ApiProperty({ type: () => CartQuoteItemResponseDto, isArray: true })
  items!: CartQuoteItemResponseDto[];
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ type: String, nullable: true }) currency!: string | null;
  @ApiProperty() allAvailable!: boolean;
}

export class PriceRangeResponseDto {
  @ApiProperty({ type: Number, nullable: true }) min!: number | null;
  @ApiProperty({ type: Number, nullable: true }) max!: number | null;
  @ApiProperty({ enum: ["GEL"] }) currency!: "GEL";
}

export class FilterOptionsResponseDto {
  @ApiProperty({ enum: VEHICLE_CLASSES, isArray: true }) vehicleClass!: Array<
    (typeof VEHICLE_CLASSES)[number]
  >;
  @ApiProperty({ enum: PRODUCT_TYPES, isArray: true }) productType!: Array<
    (typeof PRODUCT_TYPES)[number]
  >;
  @ApiProperty({ enum: SEASON_GROUPS, isArray: true }) seasonGroup!: Array<
    (typeof SEASON_GROUPS)[number]
  >;
  @ApiProperty({ type: Boolean, isArray: true }) commercial!: boolean[];
  @ApiProperty({ type: String, isArray: true }) radius!: string[];
  @ApiProperty({ type: () => BrandReferenceResponseDto, isArray: true })
  brands!: BrandReferenceResponseDto[];
  @ApiProperty({ type: () => PriceRangeResponseDto })
  priceRange!: PriceRangeResponseDto;
}

export class FitmentNamedResponseDto {
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
}

export class FitmentTireSizeResponseDto {
  @ApiPropertyOptional() widthMm?: number;
  @ApiPropertyOptional() aspect?: number;
  @ApiProperty() rimDiameterInch!: number;
  @ApiProperty() raw!: string;
}

export class FitmentOemByRimResponseDto {
  @ApiProperty() rimDiameterInch!: number;
  @ApiProperty({ type: () => FitmentTireSizeResponseDto })
  front!: FitmentTireSizeResponseDto;
  @ApiPropertyOptional({ type: () => FitmentTireSizeResponseDto })
  rear?: FitmentTireSizeResponseDto;
}

export class FitmentTrimResponseDto {
  @ApiProperty() trimSlug!: string;
  @ApiProperty() trimName!: string;
  @ApiProperty({ type: Number, isArray: true }) rimDiametersInch!: number[];
  @ApiProperty({ type: () => FitmentOemByRimResponseDto, isArray: true })
  oemBySize!: FitmentOemByRimResponseDto[];
  @ApiProperty() staggered!: boolean;
  @ApiProperty() minLoadIndex!: number;
  @ApiProperty() oemSpeedRating!: string;
}

export class FitmentLookupResponseDto {
  @ApiProperty() make!: string;
  @ApiProperty() model!: string;
  @ApiProperty() year!: number;
  @ApiProperty({ type: () => FitmentTrimResponseDto, isArray: true })
  trims!: FitmentTrimResponseDto[];
}

export class LiveHealthResponseDto {
  @ApiProperty({ enum: ["ok"] }) status!: "ok";
}

export class ReadinessChecksResponseDto {
  @ApiProperty({ enum: ["ok"] }) database!: "ok";
  @ApiProperty({ enum: ["ok"] }) storage!: "ok";
}

export class ReadyHealthResponseDto extends LiveHealthResponseDto {
  @ApiProperty({ type: () => ReadinessChecksResponseDto })
  checks!: ReadinessChecksResponseDto;
}
