/** Closed error contract for the additive internal-operations routes. */
const routes: Array<[string, string]> = [
  ...['summary', 'orders', 'payments', 'inventory', 'vehicles', 'customers', 'config',
    'orders/:id/workflow', 'inventory/:id/history', 'customers/:id/history']
    .map((path): [string, string] => ['GET', path]),
  ['PATCH', 'vehicles/:id'],
  ...['orders/:id/allocate', 'orders/:id/issue', 'orders/:id/return',
    'orders/:id/refunds', 'inventory/:id/count']
    .map((path): [string, string] => ['POST', path]),
];
const errors: Array<[number, string]> = [
  [400, 'INVALID_REQUEST'], [401, 'UNAUTHORIZED'], [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'], [409, 'CONFLICT'], [429, 'RATE_LIMITED'],
  [500, 'INTERNAL_ERROR'], [503, 'SERVICE_UNAVAILABLE'],
];
export const OPERATIONS_PROBLEM_ENTRIES = routes.flatMap(([method, suffix]) =>
  errors.map(([status, code]) => ({
    operationId: `internal-operations:${method}:${suffix}`,
    method, path: `/admin/v1/operations/${suffix}`, status,
    codes: [code], defaultCode: code,
    requiredHeaders: ['X-Server-Correlation-Id', 'Cache-Control'],
  })),
);
