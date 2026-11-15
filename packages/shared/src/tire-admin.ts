/**
 * Tire-model + product (size) admin contract — shared by @tyre/api and
 * @tyre/adminka. Mirrors the /admin/tire-models and /admin/products endpoints.
 *
 * Unlike the public catalog projection, AdminProduct includes wholesalePrice —
 * these types must never be used to serve anonymous clients.
 */

export interface AdminTireModelListItem {
  id: string;
  name: string;
  slug: string;
  brand: { id: string; name: string };
  productCount: number;
  photoCount: number;
}

export interface AdminTireModelList {
  total: number;
  page: number;
  pageSize: number;
  items: AdminTireModelListItem[];
}

export interface AdminProduct {
  id: string;
  code: string;
  slug: string;
  productType: "tire" | "disk";
  vehicleClass: "passenger" | "truck";
  /** Persisted reviewed classification; nullable until the maintenance backfill is applied. */
  vehicleClassification: string | null;
  sizeSystem: "metric" | "inch";
  brandId: string;
  patternKey: string;
  tireModelId: string;
  size: string;
  width: number;
  profile: number | null;
  rimDiameter: number;
  radius: string;
  construction: "radial" | "bias";
  commercial: boolean;
  overallDiameter: number | null;
  loadSpeedIndex: string | null;
  plyRating: string | null;
  treadType: string | null;
  application: string;
  season: string | null;
  seasonGroup: "summer" | "all_season" | "winter" | null;
  country: string | null;
  unit: string;
  retailPrice: number;
  wholesalePrice: number;
  currency: string;
  stockStatus: "in_stock" | "limited" | "out_of_stock";
  stockQty: number | null;
  name: string;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminPhoto {
  id: string;
  /** Full public URL (base URL + object key), ready for <img src>. */
  url: string;
  position: number;
}

export interface AdminTireModelDetail {
  id: string;
  name: string;
  slug: string;
  brand: { id: string; name: string };
  photoCount: number;
  photos: AdminPhoto[];
  products: AdminProduct[];
}

export interface ReorderPhotosRequest {
  /** Every photo id of the model, in the desired display order. */
  photoIds: string[];
}

export interface CreateTireModelRequest {
  brandId: string;
  name: string;
}

export interface UpdateTireModelRequest {
  name: string;
}

/**
 * Creating a size under a model. The server derives everything the catalog
 * composes from these (size string, slug, radius label, Georgian name,
 * patternKey, brandId) — overridable where marked.
 */
export interface CreateProductRequest {
  /** Real SKU; becomes both id and code. */
  code: string;
  width: number;
  profile?: number | null;
  rimDiameter: number;
  commercial: boolean;
  construction: "radial" | "bias";
  vehicleClass: "passenger" | "truck";
  /** Defaults to 'tire'. */
  productType?: "tire" | "disk";
  season?: string | null;
  seasonGroup?: "summer" | "all_season" | "winter" | null;
  loadSpeedIndex?: string | null;
  plyRating?: string | null;
  treadType?: string | null;
  overallDiameter?: number | null;
  country?: string | null;
  retailPrice: number;
  wholesalePrice: number;
  stockStatus?: "in_stock" | "limited" | "out_of_stock";
  stockQty?: number | null;
  isPublished?: boolean;
  /** Override the composed raw size string (e.g. odd truck formats). */
  size?: string;
  /** Override the derived application label. */
  application?: string;
}

/**
 * Editing a size. Everything optional; changing any size-defining field
 * (width/profile/rimDiameter/commercial) recomposes size/slug/radius/name
 * server-side. Moving to a different tireModel is NOT supported here.
 */
export type UpdateProductRequest = Partial<Omit<CreateProductRequest, "code">>;
