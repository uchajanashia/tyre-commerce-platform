/**
 * Field-composition rules for Product rows, reverse-engineered from the real
 * catalog and verified against all 606 rows (slug: exact match; radius: 602/606,
 * the 4 outliers are source inconsistencies). Used by the admin size endpoints
 * so admin-created products look exactly like imported ones.
 */

/** "155R12C" / "175/70R12" / "11.75R19.5" */
export function composeSize(
  width: number,
  profile: number | null | undefined,
  rimDiameter: number,
  commercial: boolean,
): string {
  const prof = profile === null || profile === undefined ? '' : `/${profile}`;
  return `${width}${prof}R${rimDiameter}${commercial ? 'C' : ''}`;
}

/** Filter label: "R-12", "R-22.5", "R-16C". */
export function composeRadius(rimDiameter: number, commercial: boolean): string {
  return `R-${rimDiameter}${commercial ? 'C' : ''}`;
}

/** "155r12c-roadx-002277" — slugified size + brand slug + SKU. */
export function composeProductSlug(size: string, brandId: string, code: string): string {
  const sizeSlug = size
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${sizeSlug}-${brandId}-${code}`;
}

/** Georgian display name: "საბურავი 155R13C RXQUEST C02 85/83Q-ROADX". */
export function composeProductName(
  size: string,
  modelName: string,
  loadSpeedIndex: string | null | undefined,
  brandName: string,
): string {
  const lsi = loadSpeedIndex ? ` ${loadSpeedIndex}` : '';
  return `საბურავი ${size} ${modelName}${lsi}-${brandName}`;
}

/** Product.patternKey convention: "{BRAND} {MODEL}" (the public site derives the
 *  displayed model name from this string). */
export function composePatternKey(brandName: string, modelName: string): string {
  return `${brandName} ${modelName}`;
}

/** Default application label by commercial flag (the two dominant catalog values). */
export function defaultApplication(commercial: boolean): string {
  return commercial ? 'ახალი/მსუბუქი-C' : 'ახალი/მსუბუქი';
}

export const DEFAULT_UNIT = 'ცალი';
