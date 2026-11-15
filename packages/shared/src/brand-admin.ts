/**
 * Brand admin contract — shared by @tyre/api (BrandsAdminController) and
 * @tyre/adminka. Mirrors the /admin/brands endpoints.
 *
 * NOTE: a brand's `id` IS its slug (e.g. "roadx"), generated server-side from the
 * name at creation. It is the public bookmarkable URL segment (/brands/:id) and
 * the products filter value, so it stays stable on rename.
 */

export interface AdminBrand {
  id: string;
  name: string;
  defaultCountry: string | null;
  productCount: number;
  tireModelCount: number;
}

export interface CreateBrandRequest {
  name: string;
}

export interface UpdateBrandRequest {
  name: string;
}
