import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { VehicleClassification } from "@tyre/shared";

import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import {
  catalogClassWhere,
  deriveCatalogClass,
  type CatalogClass,
} from "./catalog-classification";
import { ListProductsQuery, SizeFacetsQuery } from "./dto/list-products.query";
import { serializePublicProduct } from "./public-product.serializer";
import type { PublicAvailability } from "./public-product.serializer";

/**
 * Internal query projection used to construct the public Product DTO.
 * `wholesalePrice` is deliberately NOT selected. Private stock fields are read
 * only to derive binary availability and are stripped by serializePublicProduct.
 */
export const PUBLIC_PRODUCT_SOURCE_SELECT = {
  id: true,
  code: true,
  slug: true,
  productType: true,
  vehicleClass: true,
  vehicleClassification: true,
  sizeSystem: true,
  brandId: true,
  patternKey: true,
  size: true,
  width: true,
  profile: true,
  rimDiameter: true,
  radius: true,
  construction: true,
  commercial: true,
  overallDiameter: true,
  loadSpeedIndex: true,
  plyRating: true,
  treadType: true,
  application: true,
  season: true,
  seasonGroup: true,
  country: true,
  unit: true,
  retailPrice: true,
  currency: true,
  stockStatus: true,
  stockQty: true,
  reservedQty: true,
  name: true,
  isPublished: true,
  createdAt: true,
  updatedAt: true,
  brand: { select: { id: true, name: true, defaultCountry: true } },
  // Ordered model photos → flattened to a public `photos: string[]` (URLs).
  tireModel: {
    select: {
      photos: { select: { url: true }, orderBy: { position: "asc" as const } },
    },
  },
  // wholesalePrice: INTENTIONALLY OMITTED — never exposed publicly.
} satisfies Prisma.ProductSelect;

type PublicProductSourceRow = Prisma.ProductGetPayload<{
  select: typeof PUBLIC_PRODUCT_SOURCE_SELECT;
}>;

export type PublicProduct = Omit<
  PublicProductSourceRow,
  "tireModel" | "stockQty" | "stockStatus" | "reservedQty" | "vehicleClassification"
> & {
  catalogClass: CatalogClass;
  vehicleClassification: VehicleClassification;
  availability: PublicAvailability;
  photos: string[];
};

/**
 * Marketing tyre-type category → the exact raw `season` string it selects.
 * Derived from the real catalog's distinct `season` values (docs/03-DATA-MODEL);
 * these 7 keys partition all 603 tyres (the 3 disks have season = null).
 *
 * NOTE the deliberate A/T split (product-owner decision): the source has two
 * distinct A/T strings — "A/T" and "A/T-ყველა სეზონი" — and NO 3PMSF/snowflake
 * field, so the winter-vs-universal distinction is taken literally from the
 * string. If a real snowflake flag is added later, revisit `winter_at`/`at`.
 * The frontend mirrors this map in fitment-api.mapper.ts (SEASON_TO_CATEGORY).
 */
export const CATEGORY_TO_SEASON: Record<string, string> = {
  summer: "ზაფხული",
  all_season: "ყველა სეზონი",
  winter_at: "A/T", // ზამთრის (A/T)
  ms: "M+S", // ტალახი და თოვლი (M+S)
  ht: "H/T", // საგზაო (H/T)
  at: "A/T-ყველა სეზონი", // უნივერსალური (A/T)
  mt: "M/T", // უგზოობის (M/T)
};

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Flatten the nested tireModel.photos keys into public `photos: string[]` URLs. */
  private serializePublic(product: PublicProductSourceRow): PublicProduct {
    return {
      ...serializePublicProduct(product, (url) => this.storage.publicUrl(url)),
      catalogClass: deriveCatalogClass(product),
    };
  }

  async list(query: ListProductsQuery): Promise<{
    total: number;
    page: number;
    pageSize: number;
    items: PublicProduct[];
  }> {
    const {
      page,
      pageSize,
      vehicleClass,
      catalogClass,
      productType,
      seasonGroup,
      category,
      radius,
      width,
      profile,
      rimDiameter,
      size,
      brand,
      commercial,
      q,
      sort,
    } = query;

    const where: Prisma.ProductWhereInput = { isPublished: true };
    if (vehicleClass) where.vehicleClass = vehicleClass;
    if (productType) where.productType = productType;
    // The explicit storefront journey wins over legacy low-level filters so a
    // contradictory query cannot leak disks into a tire class (or vice versa).
    if (catalogClass) {
      delete where.vehicleClass;
      delete where.productType;
      Object.assign(where, catalogClassWhere(catalogClass));
    }
    if (seasonGroup) where.seasonGroup = seasonGroup;
    // The tyre-type category filters on the exact raw `season` string(s).
    // Multi-select → OR-combined via `season IN (...)`.
    if (category?.length) {
      const seasons = category
        .map((c) => CATEGORY_TO_SEASON[c])
        .filter((s): s is string => Boolean(s));
      if (seasons.length) where.season = { in: seasons };
    }
    if (radius) where.radius = radius;
    // Size search — exact match, AND-combined; absent params don't filter, so
    // (e.g.) NULL-profile commercial tires stay visible until a profile is picked.
    if (width !== undefined) where.width = width;
    if (profile !== undefined) where.profile = profile;
    if (rimDiameter !== undefined) where.rimDiameter = rimDiameter;
    if (size) where.size = size.trim();
    if (typeof commercial === "boolean") where.commercial = commercial;
    if (brand) {
      where.brand = {
        OR: [{ id: brand }, { name: { equals: brand, mode: "insensitive" } }],
      };
    }
    const search = q?.trim();
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
        { patternKey: { contains: search, mode: "insensitive" } },
        { size: { contains: search, mode: "insensitive" } },
        { brand: { name: { contains: search, mode: "insensitive" } } },
      ];
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput =
      sort === "price_asc"
        ? { retailPrice: "asc" }
        : sort === "price_desc"
          ? { retailPrice: "desc" }
          : { code: "asc" };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        select: PUBLIC_PRODUCT_SOURCE_SELECT,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      items: items.map((p) => this.serializePublic(p)),
    };
  }

  /**
   * Distinct size values actually present in the published catalog, so the
   * size-search dropdowns only ever offer real sizes. NULLs excluded; each list
   * sorted numerically ascending. Cheap (three indexed distinct scans).
   */
  async sizes(query: SizeFacetsQuery): Promise<{
    widths: number[];
    profiles: number[];
    diameters: number[];
    inchSizes: string[];
  }> {
    const base: Prisma.ProductWhereInput = { isPublished: true };
    if (query.catalogClass)
      Object.assign(base, catalogClassWhere(query.catalogClass));
    if (query.category?.length) {
      const seasons = query.category
        .map((category) => CATEGORY_TO_SEASON[category])
        .filter((season): season is string => Boolean(season));
      if (seasons.length) base.season = { in: seasons };
    }
    if (query.brand) {
      base.brand = {
        OR: [
          { id: query.brand },
          { name: { equals: query.brand, mode: "insensitive" } },
        ],
      };
    }

    // Metric fields cascade through the other selected dimensions. A facet
    // deliberately does not constrain itself, so users can change that value.
    const metric = { ...base, sizeSystem: "metric" as const };
    const widthWhere: Prisma.ProductWhereInput = { ...metric };
    const profileWhere: Prisma.ProductWhereInput = { ...metric };
    const diameterWhere: Prisma.ProductWhereInput = { ...metric };
    if (query.profile !== undefined) widthWhere.profile = query.profile;
    if (query.rimDiameter !== undefined)
      widthWhere.rimDiameter = query.rimDiameter;
    if (query.width !== undefined) profileWhere.width = query.width;
    if (query.rimDiameter !== undefined)
      profileWhere.rimDiameter = query.rimDiameter;
    if (query.width !== undefined) diameterWhere.width = query.width;
    if (query.profile !== undefined) diameterWhere.profile = query.profile;

    const [widths, profiles, diameters, inchSizes] = await Promise.all([
      this.prisma.product.findMany({
        where: widthWhere,
        distinct: ["width"],
        select: { width: true },
        orderBy: { width: "asc" },
      }),
      this.prisma.product.findMany({
        where: { ...profileWhere, profile: { not: null } },
        distinct: ["profile"],
        select: { profile: true },
        orderBy: { profile: "asc" },
      }),
      this.prisma.product.findMany({
        where: diameterWhere,
        distinct: ["rimDiameter"],
        select: { rimDiameter: true },
        orderBy: { rimDiameter: "asc" },
      }),
      this.prisma.product.findMany({
        where: { ...base, sizeSystem: "inch" },
        distinct: ["size"],
        select: { size: true },
        orderBy: { size: "asc" },
      }),
    ]);

    return {
      widths: widths.map((w) => w.width),
      profiles: profiles
        .map((p) => p.profile)
        .filter((p): p is number => p !== null),
      diameters: diameters.map((d) => d.rimDiameter),
      inchSizes: inchSizes.map((item) => item.size),
    };
  }

  /** Single product by id or code (id === code in the catalog). */
  async findOne(idOrCode: string): Promise<PublicProduct> {
    const product = await this.prisma.product.findFirst({
      where: { isPublished: true, OR: [{ id: idOrCode }, { code: idOrCode }] },
      select: PUBLIC_PRODUCT_SOURCE_SELECT,
    });
    if (!product) {
      throw new NotFoundException(`Product "${idOrCode}" not found`);
    }
    return this.serializePublic(product);
  }
}
