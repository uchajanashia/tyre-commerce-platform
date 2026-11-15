# Validation — 15 November 2026

| Check | Result |
| --- | --- |
| Shared contracts, API TypeScript/NestJS, normal storefront and full admin builds | Pass |
| Browser-only storefront and operations demo builds | Pass |
| Portable API domain/HTTP tests | 177/177 pass |
| Generated-client runtime tests | 9/9 pass |
| Static entry points and asset/import closure | 551 files, 419 references, no missing paths |
| PostgreSQL 16 migrations | All 27 applied to an isolated database |
| Synthetic seed | 44 fixture products and one local-only administrator |
| Actual HTTP readiness, catalog, cart quote and admin login | Pass |
| Public wholesale-price and stock-count redaction | Pass |
| npm audit, all dependencies | 3 high, 29 moderate, 2 low; 0 critical |
| npm audit, runtime dependencies | 3 high, 3 moderate; 0 critical |

## Remaining dependency advisories

The three high entries are one transitive chain: **MinIO 8.0.7 → query-string 7.1.3 → decode-uri-component 0.2.2**. The underlying advisories concern denial of service in decoding malformed input: [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) and [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f). This package does not claim a clean dependency audit or production deployment readiness.

The official current SDK still depends on that CommonJS query-string version. The patched decoder is ESM with a default export; forcing it into the old dependency breaks its require-as-function contract. A suggested SDK downgrade still declares the same query-string dependency. Neither unsafe change was applied. Observed MinIO paths use query serialization (`stringify`), while the copied storage service uses bucket checks, bucket policy and object operations; no decoder `parse` call was found in those SDK paths. This narrows the observed exposure but does not remove the advisory or prove general safety. Remediation needs a separately tested SDK migration or maintained compatible patch.

The storage adapter is absent from the static browser bundles. Storage is an optional local Compose profile. The remaining moderate development advisories include CLI tooling; runtime advisories remain visible in `npm audit --omit=dev`. Angular was updated within major 21, and Multer was explicitly updated to 2.5.0 with the API suite rerun.

## Scope of the passing tests

The portable API command includes domain and HTTP tests for catalog privacy, prices, stock, ordering, payment adapters, permissions, sessions, audit, governance, jobs and operational workflows. The retained original deployment-contract command is not a passing public-package check: two files require private deployment/rollback artifacts deliberately omitted from this repository. Before separating that scope, the original command reported 192 passes and 3 failures caused by omitted deployment artifacts.

The Argon2 policy test was made independent of PHC parameter order after updating dependencies. It still asserts Argon2id, version 19, memory 65536 KiB, time cost 3 and parallelism 1, plus correct/incorrect password verification.

## Runtime and browser limits

Local checks used Windows, Node 25.2.1/npm 11.6.2 and PostgreSQL 16. Node 24 LTS is the documented runtime and committed CI target. The CI workflow is prepared; it was not run remotely during local preparation.

Live API validation used only the new synthetic database and a cached MinIO image. A fresh pull of the original public MinIO image failed; photo storage therefore requires a separately supplied trusted compatible image. No live bank, wallet, external fitment provider, customer system or production account was called.

Browser visual QA was unavailable because browser automation could not confirm the current Windows browser URL and stopped. Entry files, relative resource paths, JSON and imports were checked, but this does not prove every rendered layout or interaction. Both demo entry pages are explicitly `index.html`, use a relative base and hash routing, and load their stylesheet without CSP-blocked inline handlers. Initial/style budget warnings remain in the full admin production build; they do not prevent compilation.
