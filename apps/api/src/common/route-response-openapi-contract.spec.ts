import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import "./api-problem-boundary.spec";

import type {
  AdminBrand,
  AdminInfo,
  AdminPhoto,
  AdminProduct,
  AdminTireModelDetail,
  AdminTireModelList,
  AdminTireModelListItem,
  LoginResponse,
} from "@tyre/shared";

import { AdminController } from "../admin/admin.controller";
import { BrandsAdminController } from "../admin/brands/brands-admin.controller";
import { PhotosAdminController } from "../admin/tire-models/photos-admin.controller";
import { ProductsAdminController } from "../admin/tire-models/products-admin.controller";
import { TireModelsAdminController } from "../admin/tire-models/tire-models-admin.controller";
import { AuthController } from "../auth/auth.controller";
import { BrandsController } from "../brands/brands.controller";
import { BrandsService } from "../brands/brands.service";
import { CartQuoteController } from "../checkout/cart-quote.controller";
import type { CartQuote, CartQuoteItem } from "../checkout/cart-quote.service";
import { FiltersController } from "../filters/filters.controller";
import { FitmentController } from "../fitment/fitment.controller";
import type {
  FitmentLookupResult,
  FitmentMake,
  FitmentModel,
  FitmentOemByRim,
  FitmentTireSize,
  FitmentTrim,
} from "../fitment/fitment.types";
import { HealthController } from "../health/health.controller";
import { ProductsController } from "../products/products.controller";
import {
  ProductsService,
  type PublicProduct,
} from "../products/products.service";
import {
  AdminBrandResponseDto,
  AdminPhotoResponseDto,
  AdminProductResponseDto,
  AdminTireModelDetailResponseDto,
  AdminTireModelListItemResponseDto,
  AdminTireModelListResponseDto,
  CartQuoteItemResponseDto,
  CartQuoteResponseDto,
  FitmentLookupResponseDto,
  FitmentNamedResponseDto,
  FitmentOemByRimResponseDto,
  FitmentTireSizeResponseDto,
  FitmentTrimResponseDto,
  LegacyAdminResponseDto,
  LegacyLoginResponseDto,
  ProductSizeFacetsResponseDto,
  PublicBrandResponseDto,
  PublicProductListResponseDto,
  PublicProductResponseDto,
} from "./dto/route-response.dto";

type ControllerClass = { prototype: object };
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type JsonWire<T> = T extends Date
  ? string
  : T extends readonly (infer Item)[]
    ? JsonWire<Item>[]
    : T extends object
      ? { [Key in keyof T]: JsonWire<T[Key]> }
      : T;

// These fail compilation if a service wire interface drifts from its reviewed DTO.
type _CartQuoteItemParity = Assert<
  Equal<CartQuoteItem, CartQuoteItemResponseDto>
>;
type _CartQuoteParity = Assert<Equal<CartQuote, CartQuoteResponseDto>>;
type _LegacyAdminParity = Assert<Equal<AdminInfo, LegacyAdminResponseDto>>;
type _LegacyLoginParity = Assert<Equal<LoginResponse, LegacyLoginResponseDto>>;
type _AdminBrandParity = Assert<Equal<AdminBrand, AdminBrandResponseDto>>;
type _AdminPhotoParity = Assert<Equal<AdminPhoto, AdminPhotoResponseDto>>;
type _AdminProductParity = Assert<Equal<AdminProduct, AdminProductResponseDto>>;
type _AdminModelItemParity = Assert<
  Equal<AdminTireModelListItem, AdminTireModelListItemResponseDto>
>;
type _AdminModelListParity = Assert<
  Equal<AdminTireModelList, AdminTireModelListResponseDto>
>;
type _AdminModelDetailParity = Assert<
  Equal<AdminTireModelDetail, AdminTireModelDetailResponseDto>
>;
type _PublicBrandParity = Assert<
  Equal<Awaited<ReturnType<BrandsService["findOne"]>>, PublicBrandResponseDto>
>;
function assertPublicProductParity(
  wire: JsonWire<PublicProduct>,
  dto: PublicProductResponseDto,
): void {
  const dtoFromWire: PublicProductResponseDto = wire;
  const wireFromDto: JsonWire<PublicProduct> = dto;
  void dtoFromWire;
  void wireFromDto;
}

function assertPublicProductListParity(
  wire: JsonWire<Awaited<ReturnType<ProductsService["list"]>>>,
  dto: PublicProductListResponseDto,
): void {
  const dtoFromWire: PublicProductListResponseDto = wire;
  const wireFromDto: JsonWire<Awaited<ReturnType<ProductsService["list"]>>> =
    dto;
  void dtoFromWire;
  void wireFromDto;
}
void assertPublicProductParity;
void assertPublicProductListParity;
type _ProductSizeFacetsParity = Assert<
  Equal<
    Awaited<ReturnType<ProductsService["sizes"]>>,
    ProductSizeFacetsResponseDto
  >
>;
type _FitmentMakeParity = Assert<Equal<FitmentMake, FitmentNamedResponseDto>>;
type _FitmentModelParity = Assert<Equal<FitmentModel, FitmentNamedResponseDto>>;
type _FitmentTireSizeParity = Assert<
  Equal<FitmentTireSize, FitmentTireSizeResponseDto>
>;
type _FitmentOemParity = Assert<
  Equal<FitmentOemByRim, FitmentOemByRimResponseDto>
>;
type _FitmentTrimParity = Assert<Equal<FitmentTrim, FitmentTrimResponseDto>>;
type _FitmentLookupParity = Assert<
  Equal<FitmentLookupResult, FitmentLookupResponseDto>
>;

interface ExpectedOperation {
  readonly controller: ControllerClass;
  readonly handler: string;
  readonly operationId: string;
  readonly status: number;
  readonly array: boolean;
}

const EXPECTED: readonly ExpectedOperation[] = [
  {
    controller: AuthController,
    handler: "login",
    operationId: "auth.login",
    status: 201,
    array: false,
  },
  {
    controller: AuthController,
    handler: "revokeSessions",
    operationId: "auth.revoke-sessions",
    status: 201,
    array: false,
  },
  {
    controller: BrandsAdminController,
    handler: "list",
    operationId: "brands-admin.list",
    status: 200,
    array: true,
  },
  {
    controller: BrandsAdminController,
    handler: "create",
    operationId: "brands-admin.create",
    status: 201,
    array: false,
  },
  {
    controller: BrandsAdminController,
    handler: "rename",
    operationId: "brands-admin.rename",
    status: 200,
    array: false,
  },
  {
    controller: BrandsAdminController,
    handler: "remove",
    operationId: "brands-admin.remove",
    status: 200,
    array: false,
  },
  {
    controller: AdminController,
    handler: "me",
    operationId: "admin.me",
    status: 200,
    array: false,
  },
  {
    controller: PhotosAdminController,
    handler: "remove",
    operationId: "photos-admin.remove",
    status: 200,
    array: false,
  },
  {
    controller: ProductsAdminController,
    handler: "remove",
    operationId: "products-admin.remove",
    status: 200,
    array: false,
  },
  {
    controller: ProductsAdminController,
    handler: "update",
    operationId: "products-admin.update",
    status: 200,
    array: false,
  },
  {
    controller: PhotosAdminController,
    handler: "reorder",
    operationId: "photos-admin.reorder",
    status: 200,
    array: true,
  },
  {
    controller: PhotosAdminController,
    handler: "upload",
    operationId: "photos-admin.upload",
    status: 201,
    array: true,
  },
  {
    controller: TireModelsAdminController,
    handler: "createProduct",
    operationId: "tire-models-admin.create-product",
    status: 201,
    array: false,
  },
  {
    controller: TireModelsAdminController,
    handler: "remove",
    operationId: "tire-models-admin.remove",
    status: 200,
    array: false,
  },
  {
    controller: TireModelsAdminController,
    handler: "detail",
    operationId: "tire-models-admin.detail",
    status: 200,
    array: false,
  },
  {
    controller: TireModelsAdminController,
    handler: "rename",
    operationId: "tire-models-admin.rename",
    status: 200,
    array: false,
  },
  {
    controller: TireModelsAdminController,
    handler: "list",
    operationId: "tire-models-admin.list",
    status: 200,
    array: false,
  },
  {
    controller: TireModelsAdminController,
    handler: "create",
    operationId: "tire-models-admin.create",
    status: 201,
    array: false,
  },
  {
    controller: BrandsController,
    handler: "findOne",
    operationId: "brands.find-one",
    status: 200,
    array: false,
  },
  {
    controller: BrandsController,
    handler: "list",
    operationId: "brands.list",
    status: 200,
    array: true,
  },
  {
    controller: CartQuoteController,
    handler: "quote",
    operationId: "cart-quote.quote",
    status: 201,
    array: false,
  },
  {
    controller: FiltersController,
    handler: "options",
    operationId: "filters.options",
    status: 200,
    array: false,
  },
  {
    controller: FitmentController,
    handler: "lookup",
    operationId: "fitment.lookup",
    status: 200,
    array: false,
  },
  {
    controller: FitmentController,
    handler: "years",
    operationId: "fitment.years",
    status: 200,
    array: true,
  },
  {
    controller: FitmentController,
    handler: "models",
    operationId: "fitment.models",
    status: 200,
    array: true,
  },
  {
    controller: FitmentController,
    handler: "makes",
    operationId: "fitment.makes",
    status: 200,
    array: true,
  },
  {
    controller: HealthController,
    handler: "live",
    operationId: "health.live",
    status: 200,
    array: false,
  },
  {
    controller: HealthController,
    handler: "ready",
    operationId: "health.ready",
    status: 200,
    array: false,
  },
  {
    controller: HealthController,
    handler: "check",
    operationId: "health.check",
    status: 200,
    array: false,
  },
  {
    controller: ProductsController,
    handler: "findOne",
    operationId: "products.find-one",
    status: 200,
    array: false,
  },
  {
    controller: ProductsController,
    handler: "sizes",
    operationId: "products.sizes",
    status: 200,
    array: false,
  },
  {
    controller: ProductsController,
    handler: "list",
    operationId: "products.list",
    status: 200,
    array: false,
  },
] as const;

test("all 32 previously blocked routes publish status-bound exact response metadata", () => {
  assert.equal(EXPECTED.length, 32);
  assert.equal(
    new Set(EXPECTED.map(({ operationId }) => operationId)).size,
    EXPECTED.length,
  );

  for (const expected of EXPECTED) {
    const method = (
      expected.controller.prototype as unknown as Record<string, unknown>
    )[expected.handler];
    assert.equal(
      typeof method,
      "function",
      `${expected.operationId} handler exists`,
    );
    const responses = Reflect.getMetadata(
      "swagger/apiResponse",
      method as object,
    ) as Record<string, { type?: unknown; isArray?: boolean }> | undefined;
    const response = responses?.[String(expected.status)];
    const responseType = response?.type;
    assert.ok(
      responseType,
      `${expected.operationId} publishes status ${expected.status}`,
    );
    assert.equal(
      response?.isArray === true,
      expected.array,
      `${expected.operationId} root array parity`,
    );
    assert.equal(
      typeof responseType,
      "function",
      `${expected.operationId} response is typed`,
    );
  }
});
