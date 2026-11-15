# TYRE — commerce platform

A real Angular/NestJS workspace for tyre retail: vehicle fitment, a searchable storefront, a cart with server-owned prices, and administration for catalog and order operations. This curated source edition adds a reproducible synthetic demo and excludes the original business data and deployment configuration.

**Explore:** [storefront](https://uchajanashia.github.io/tyre-commerce-platform/storefront/) · [operations simulation](https://uchajanashia.github.io/tyre-commerce-platform/admin/) · [architecture and code guide](ARCHITECTURE.md). The demo URLs become available when this repository's Pages site is enabled from `main /docs`.

## What is implemented

| Area | Source and behavior |
| --- | --- |
| Storefront | Angular 21, lazy routes, responsive Georgian UI, season/size/brand filters, vehicle garage and fitment, product inspection and cart |
| Commerce API | NestJS 11, DTO validation, public/private product projections, authoritative cart quotes, explicit order transitions, payment attempts and provider abstractions |
| Operations | Orders, payment review, stock reservations/movements, inventory adjustments, customer history and idempotent workflow commands |
| Administration | A separate Angular application; typed client contracts, role/permission checks, account/session revocation and audit views |
| Persistence | Prisma 6, PostgreSQL 16 migrations, product/model normalization, transactional commerce records and database permission boundaries |
| Security foundations | Identity/MFA, governance approvals, audit reader and job foundations exist in source. Rollout gates remain disabled; the customer data vault is a contract prototype, not a deployed encrypted customer store. |

## Run the browser demos

Requirements: Node.js 24 LTS and npm 11. The committed lockfile is used by `npm ci`.

```sh
npm ci
npm run build:demo
python -m http.server 8088 --directory docs
```

Open `http://localhost:8088/`. The same output works on GitHub project Pages and beneath a nested URL. Hash routing preserves reloads without server rewrites.

The storefront uses 44 fictional fixture products and local visual assets. Its catalog, product, garage and cart are the actual application components with an explicit demo data provider. Quotes simulate the public API contract. Checkout and banking are disabled. The operations demo is the project's existing local simulation of selected workflows; the complete authenticated admin code is also included.

Neither static demo contacts the live business API. All Angular HTTP calls end in a demo interceptor; unsupported actions return an explicit error. The source's normal HTTP providers remain separate.

## Run the actual backend and frontends

```sh
npm ci
node tools/setup-local.mjs
docker compose up -d --wait db
npm run prisma:generate --workspace @tyre/api
npm exec --workspace @tyre/api -- prisma migrate deploy
node tools/seed-demo.cjs
npm run build:contracts
npm run start:api
```

In separate terminals, run `npm run start:storefront` and `npm run start:admin`. The normal apps use `http://127.0.0.1:3000`, storefront port 4200 and admin port 4300. API documentation is at `/openapi` in development.

The setup script creates ignored local environment files with random credentials and never prints them. The seed is restricted to the named localhost `tyre_demo` database and creates `admin@example.invalid`; its password is the generated `DEMO_ADMIN_PASSWORD` in your local `.env`. It inserts synthetic records only and does not reset an existing database. If changing an existing local admin password, manage it explicitly; rerunning the seed preserves the account.

Product-photo storage is optional. Configure a trusted compatible object-store image with `TYRE_MINIO_IMAGE`, then run `docker compose --profile storage up -d storage`. The MinIO client and integration are preserved; the original public Docker image could not be pulled during validation. A pre-existing cached image was used for the local storage check. Without storage, catalog/auth still run, uploads fail explicitly and `/health/ready` correctly reports storage unavailable. No payment-provider account is needed for local development.

`docker compose down` stops this isolated stack and preserves its demo volume. These development settings are not a production deployment recipe.

## Tests and verification

```sh
npm run prisma:generate --workspace @tyre/api
npm test
npm run build
npm run build:demo
npm audit
```

The portable backend suite covers product-data privacy, size classification, quote validation, order state transitions, provider boundaries, permission scope, identity/session behavior, audit sanitization, governance and operational workflows. Client runtime tests exercise typed request/error behavior.

Two retained upstream test files assert the original private deployment tree: `customer-master-foundation.spec.ts` and `customer-data-vault.contract.spec.ts`. They are excluded from the portable default command. The original API command remains `npm run test:upstream-deployment-contracts --workspace @tyre/api`; it requires omitted deployment/rollback artifacts and is not a passing public-package check. Generated-client conformance tests also depend on a private governance report; the portable client command runs its independent runtime suite.

Validation evidence and exact remaining limitations are recorded in [VALIDATION.md](VALIDATION.md). No claim is made that the static demo proves a live banking integration, production authorization rollout, or production load capacity.

**Dependency limitation:** the optional MinIO integration retains three high audit entries in one transitive decoder chain. They are absent from the static browser bundles. Compatible Angular/Multer fixes were applied; the remaining SDK dependency requires a separately tested migration. See the linked validation record before deploying the backend.

## Source provenance

The application source and existing visual assets were curated from the author's TYRE workspace. Demo adapters, local setup, synthetic seed, public packaging and documentation were added for this edition. Original `.env` files, customer/catalog exports, invoices, database backups, operational logs, private deployment tooling and Git history are excluded. No new license grant is implied; third-party dependency notices are retained in the generated builds.
