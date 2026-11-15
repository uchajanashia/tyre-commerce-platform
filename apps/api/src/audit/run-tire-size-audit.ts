import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

import { correctedSourceSize } from '../maintenance/catalog-size-corrections';
import { auditTireProducts, type AuditProduct, type AuditRow, type IssueCode } from './tire-size-audit';

const prisma = new PrismaClient();
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const REPORT_DIR = resolve(REPO_ROOT, 'reports');
const COMMAND = 'npm run audit:tire-sizes';
const COLUMNS: (keyof AuditRow)[] = [
  'database_id', 'product_code', 'brand', 'model', 'product_name', 'category',
  'current_full_size', 'current_width', 'current_profile', 'current_radius',
  'issue_codes', 'issue_description', 'detected_format', 'source_value', 'active_status',
];

function csvCell(value: unknown): string {
  const raw = Array.isArray(value) ? value.join('|') : value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function productList(rows: AuditRow[]): string {
  if (!rows.length) return '_None._';
  return rows.map((row) =>
    `- ${row.product_code} — ${row.brand} ${row.model}; ${row.current_full_size}; width=${String(row.current_width)}; profile=${String(row.current_profile)}; active=${row.active_status}`,
  ).join('\n');
}

function matching(rows: AuditRow[], issue: IssueCode): AuditRow[] {
  return rows.filter((row) => row.issue_codes.includes(issue));
}

function renderSummary(products: AuditProduct[], rows: AuditRow[]): string {
  const zero = matching(rows, 'ZERO_PROFILE');
  const inch = matching(rows, 'INCH_BASED_SIZE');
  const both = rows.filter((row) => row.issue_codes.length === 2);
  const activeProblems = rows.filter((row) => row.active_status).length;
  const inactiveProblems = rows.length - activeProblems;
  const activeScanned = products.filter((product) => product.isPublished).length;
  const inactiveScanned = products.length - activeScanned;
  const reconciled = zero.length + inch.length - both.length;

  if (reconciled !== rows.length) {
    throw new Error(`Count reconciliation failed: ${rows.length} != ${zero.length} + ${inch.length} - ${both.length}`);
  }

  return `# Tire size audit summary

This is a read-only audit of every tire product. Non-passenger categories, commercial suffixes, fractional rim diameters, null profiles, and large metric widths are valid and do not create findings.

## Counts

- Total tire products scanned: **${products.length}** (${activeScanned} active; ${inactiveScanned} inactive)
- Products with \`profile = 0\`: **${zero.length}**
- Products with an inch-based size: **${inch.length}**
- Products having both problems: **${both.length}**
- Total unique problematic products: **${rows.length}** (${activeProblems} active; ${inactiveProblems} inactive)

Reconciliation:

\`\`\`text
${rows.length} = ${zero.length} + ${inch.length} - ${both.length}
unique = zero-profile + inch-size - both
\`\`\`

## Exact detection rules

Only these two rules are used:

1. \`ZERO_PROFILE\`: the stored Prisma \`Product.profile\` value is the numeric value \`0\` using strict equality. \`null\`, missing values, and text \`"0"\` do not match.
2. \`INCH_BASED_SIZE\`: one or more of the following is present in the stored row or corroborating import row:
   - numeric \`width > 0 && width < 100\`;
   - leading width below 100 in radial notation, including \`12.00R20\`, \`12/00R20\`, or \`9.5R17.5\`;
   - leading inch width/aspect notation such as \`12.5/80R18\`;
   - flotation \`x\` notation such as \`31x10.5R15\` or \`18x7-8\`;
   - hyphen industrial/agricultural notation such as \`10-16.5\`, \`26.5-25\`, or \`7.00-9\`.

The audit examines and preserves \`size\`, numeric \`width\`, \`profile\`, \`radius\`, product \`name\`, category context, and \`wheels_catalog.json\` source size in \`source_value\`. Profile supplies the exact zero check. Width and size/name/import notation supply inch evidence. Radius and category are contextual checks only: neither a fractional rim nor a \`C\` suffix is treated as inch-based, and category never creates a finding by itself.

## Required negative and positive checks

- \`315/80R22.5\`: not inch-based
- \`385/65R22.5\`: not inch-based
- \`225/75R17.5\`: not inch-based
- \`205/65R16C\`: not inch-based
- \`155R12C\` with null profile: not reported for null profile alone
- \`12.5/80R18\`: inch-based
- \`31x10.5R15\`: inch-based
- \`18x7-8\`: inch-based
- \`7.00-9\`: inch-based
- Stored zero-profile coverage: **${zero.length}/${products.filter((product) => product.profile === 0).length} included**

## Full list: ZERO_PROFILE

${productList(zero)}

## Full list: INCH_BASED_SIZE

${productList(inch)}

## Full list: both problems

${productList(both)}

## Audit command and database query

Command:

\`\`\`powershell
${COMMAND}
\`\`\`

Complete read-only Prisma query (one query; no published/category filtering and no N+1 access):

\`\`\`ts
prisma.product.findMany({
  where: { productType: 'tire' },
  include: {
    brand: { select: { name: true } },
    tireModel: { select: { name: true } },
  },
  orderBy: { id: 'asc' },
})
\`\`\`
`;
}

async function main(): Promise<void> {
  const source = JSON.parse(readFileSync(resolve(REPO_ROOT, 'wheels_catalog.json'), 'utf8')) as {
    products?: { code: string; size?: string }[];
  };
  const sourceSizes = new Map(
    (source.products ?? []).map((product) => [
      product.code,
      correctedSourceSize(product.code, product.size ?? null),
    ]),
  );
  const dbProducts = await prisma.product.findMany({
    where: { productType: 'tire' },
    include: { brand: { select: { name: true } }, tireModel: { select: { name: true } } },
    orderBy: { id: 'asc' },
  });
  const products: AuditProduct[] = dbProducts.map((product) => ({
    ...product,
    sourceSize: sourceSizes.get(product.code) ?? null,
  }));
  const rows = auditTireProducts(products);

  mkdirSync(REPORT_DIR, { recursive: true });
  const csv = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((column) => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
  writeFileSync(resolve(REPORT_DIR, 'tire-size-audit.csv'), csv, 'utf8');
  writeFileSync(resolve(REPORT_DIR, 'tire-size-audit.json'), JSON.stringify(rows, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(REPORT_DIR, 'tire-size-audit-summary.md'), renderSummary(products, rows), 'utf8');

  const zero = matching(rows, 'ZERO_PROFILE').length;
  const inch = matching(rows, 'INCH_BASED_SIZE').length;
  const both = rows.filter((row) => row.issue_codes.length === 2).length;
  console.log(JSON.stringify({ scanned: products.length, zeroProfile: zero, inchBased: inch, both, problematic: rows.length, reportDirectory: REPORT_DIR }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error('Tire size audit failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
