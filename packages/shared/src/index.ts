/**
 * @tyre/shared — shared TypeScript package.
 *
 * Shared domain types (tire, vehicle, fitment, brand, …) will live here so the
 * website, the API, and the admin panel all speak the same contract.
 */
export const SHARED_PACKAGE = "@tyre/shared";

// Transitional backend-facing aliases. Runtime endpoints remain unchanged while
// callers move from hand-maintained problem shapes to the generated contract.
export type {
  ApiProblem as GeneratedApiProblem,
  OperationId as GeneratedApiOperationId,
} from "@tyre/admin-api-client";

export * from "./auth";
export * from "./approval";
export * from "./audit";
export * from "./audit-contract-fixture";
export * from "./brand-admin";
export * from "./jobs";
export * from "./jobs-contract-fixture";
export * from "./tire-admin";
export * from "./vehicle-classification";
export * from "./operations";
