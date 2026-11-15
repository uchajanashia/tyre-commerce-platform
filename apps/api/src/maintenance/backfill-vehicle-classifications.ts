import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Prisma, PrismaClient } from '@prisma/client';
import { isVehicleClassification, resolveVehicleClass, type VehicleClassResolution } from '@tyre/shared';

type ProductRow = {
  id: string;
  code: string;
  productType: string;
  vehicleClass: string;
  vehicleClassification: string | null;
  size: string;
  width: number;
  profile: number | null;
  rimDiameter: number;
  radius: string;
  commercial: boolean;
  application: string;
  treadType: string | null;
  season: string | null;
  patternKey: string;
  name: string;
  isPublished: boolean;
};

function loadEnvironment(): void {
  const envFile = resolve(__dirname, '..', '..', '.env');
  try {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
      if (!match || process.env[match[1]!]) continue;
      process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // CI/production normally supplies DATABASE_URL directly.
  }
}

function csv(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

loadEnvironment();
const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const reportDir = resolve(repoRoot, 'reports');
const reportBase = resolve(reportDir, `vehicle-classification-backfill-${apply ? 'apply' : 'dry-run'}`);

async function hasClassificationColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Product'
        AND column_name = 'vehicleClassification'
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

async function readProducts(columnExists: boolean): Promise<ProductRow[]> {
  const classification = columnExists
    ? Prisma.raw('"vehicleClassification"')
    : Prisma.raw('NULL::text AS "vehicleClassification"');
  return prisma.$queryRaw<ProductRow[]>(Prisma.sql`
    SELECT "id", "code", "productType"::text AS "productType",
      "vehicleClass"::text AS "vehicleClass", ${classification}, "size", "width",
      "profile", "rimDiameter", "radius", "commercial", "application", "treadType",
      "season", "patternKey", "name", "isPublished"
    FROM "Product"
    WHERE "productType" = 'tire'
    ORDER BY "code"
  `);
}

async function main(): Promise<void> {
  const columnExists = await hasClassificationColumn();
  const products = await readProducts(columnExists); // one batched scan; no N+1 reads
  const verifiedMapping = JSON.parse(readFileSync(
    resolve(repoRoot, 'vehicle-assets', 'catalog-vehicle-mapping.json'), 'utf8',
  )) as { mappings: { productCode: string; vehicleAssetId: string }[] };
  const verifiedByCode = new Map(verifiedMapping.mappings.map((row) => [row.productCode, row.vehicleAssetId]));
  const priorityVerifiedClasses = new Set([
    'vehicle-highway-truck', 'vehicle-quarry-dump', 'vehicle-backhoe',
    'vehicle-wheel-loader', 'vehicle-skid-steer', 'vehicle-forklift',
  ]);
  const rows = products.map((product) => {
    const verified = verifiedByCode.get(product.code);
    let resolution: VehicleClassResolution;
    if (!isVehicleClassification(product.vehicleClassification)
      && isVehicleClassification(verified)
      && priorityVerifiedClasses.has(verified)) {
      resolution = {
        classification: verified,
        source: 'application',
        reason: 'verified-existing-special-vehicle-scene-mapping',
        normalizedSize: null,
        usedAbsoluteFallback: false,
      };
    } else {
      resolution = resolveVehicleClass(product);
      if (!isVehicleClassification(product.vehicleClassification)
        && isVehicleClassification(verified)
        && (resolution.source === 'category-fallback' || resolution.source === 'absolute-fallback')) {
        resolution = {
          classification: verified,
          source: 'application',
          reason: 'verified-existing-vehicle-scene-mapping',
          normalizedSize: resolution.normalizedSize,
          usedAbsoluteFallback: false,
        };
      }
    }
    const oldValid = isVehicleClassification(product.vehicleClassification);
    const status = oldValid ? 'ALREADY_VALID' : product.vehicleClassification ? 'INVALID_EXISTING' : 'MISSING';
    return {
      product_code: product.code,
      size: product.size,
      published: product.isPublished,
      old_class: product.vehicleClassification,
      new_class: resolution.classification,
      source: resolution.source,
      reason: resolution.reason,
      status,
      proposed_change: !oldValid,
      used_absolute_fallback: resolution.usedAbsoluteFallback,
    };
  });

  const changes = rows.filter((row) => row.proposed_change);
  const grouped = Object.values(changes.reduce<Record<string, { old_class: string | null; new_class: string; count: number }>>(
    (all, row) => {
      const key = `${row.old_class ?? '(null)'} -> ${row.new_class}`;
      all[key] ??= { old_class: row.old_class, new_class: row.new_class, count: 0 };
      all[key]!.count++;
      return all;
    }, {},
  )).sort((a, b) => b.count - a.count || a.new_class.localeCompare(b.new_class));

  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    database_column_exists: columnExists,
    total_tyre_products_scanned: products.length,
    published_tyre_products_scanned: products.filter((product) => product.isPublished).length,
    already_valid_classifications: rows.filter((row) => row.status === 'ALREADY_VALID').length,
    missing_classifications: rows.filter((row) => row.status === 'MISSING').length,
    invalid_existing_classifications: rows.filter((row) => row.status === 'INVALID_EXISTING').length,
    proposed_changes: changes.length,
    unresolved_products: 0,
    products_using_absolute_fallback: rows.filter((row) => row.used_absolute_fallback).length,
    applied_changes: 0,
    post_apply_valid_classifications: null as number | null,
    post_apply_unresolved_products: null as number | null,
    proposed_changes_by_old_and_new_class: grouped,
  };

  if (apply && !columnExists) {
    throw new Error('Apply blocked: run the new additive Prisma migration first, then rerun with --apply.');
  }
  const updates = changes.map((row) => ({ id: products.find((product) => product.code === row.product_code)!.id, classification: row.new_class }));
  if (apply && updates.length) {
    await prisma.$transaction(async (tx) => {
      const values = updates.map((row) => Prisma.sql`(${row.id}, ${row.classification})`);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "Product" AS product
        SET "vehicleClassification" = proposed.classification
        FROM (VALUES ${Prisma.join(values)}) AS proposed(id, classification)
        WHERE product.id = proposed.id
          AND (product."vehicleClassification" IS NULL
            OR product."vehicleClassification" NOT IN (${Prisma.join([...new Set(rows.map((row) => row.new_class))])}))
      `);
    });
  }
  if (apply) {
    const postApply = await readProducts(true);
    summary.applied_changes = updates.length;
    summary.post_apply_valid_classifications = postApply.filter((product) =>
      isVehicleClassification(product.vehicleClassification)).length;
    summary.post_apply_unresolved_products = postApply.length - summary.post_apply_valid_classifications;
    if (summary.post_apply_unresolved_products !== 0) {
      throw new Error(`Post-apply verification failed: ${summary.post_apply_unresolved_products} unresolved products.`);
    }
  }

  mkdirSync(reportDir, { recursive: true });
  writeFileSync(`${reportBase}.json`, `${JSON.stringify({ summary, products: rows }, null, 2)}\n`);
  const columns = ['product_code', 'size', 'published', 'old_class', 'new_class', 'source', 'reason', 'status', 'proposed_change', 'used_absolute_fallback'] as const;
  writeFileSync(`${reportBase}.csv`, `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csv(row[column])).join(',')).join('\n')}\n`);
  writeFileSync(`${reportBase}-summary.md`, `# Vehicle classification backfill ${apply ? 'apply' : 'dry-run'}\n\n`
    + `- Total tyre products scanned: **${summary.total_tyre_products_scanned}**\n`
    + `- Published tyre products scanned: **${summary.published_tyre_products_scanned}**\n`
    + `- Already valid: **${summary.already_valid_classifications}**\n`
    + `- Missing: **${summary.missing_classifications}**\n`
    + `- Invalid existing: **${summary.invalid_existing_classifications}**\n`
    + `- Proposed changes: **${summary.proposed_changes}**\n`
    + `- Applied changes: **${summary.applied_changes}**\n`
    + `- Unresolved: **${summary.unresolved_products}**\n`
    + `- Absolute fallback: **${summary.products_using_absolute_fallback}**\n`
    + `- Post-apply valid: **${summary.post_apply_valid_classifications ?? 'not run'}**\n`
    + `- Post-apply unresolved: **${summary.post_apply_unresolved_products ?? 'not run'}**\n\n`
    + `## Proposed changes by old and new class\n\n`
    + `| Old | New | Products |\n|---|---|---:|\n`
    + grouped.map((group) => `| ${group.old_class ?? '(null)'} | ${group.new_class} | ${group.count} |`).join('\n') + '\n');

  console.log(JSON.stringify(summary, null, 2));
  for (const row of changes) {
    console.log(`${row.product_code}\t${row.size}\t${row.old_class ?? '(null)'}\t${row.new_class}\t${row.reason}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
