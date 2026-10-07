# Security QA and PR #25

[PR #25](https://github.com/3D-Garage/Techlines/pull/25) adds HTTP regression checks and CI. This update rebases it onto master `a291c85` and migrates its payment checks to the durable checkout contract delivered by [#24](https://github.com/3D-Garage/Techlines/issues/24). Remaining production remediation is tracked by [#26](https://github.com/3D-Garage/Techlines/issues/26).

Required outcomes must not be weakened, skipped or changed to `todo` to make the release look ready. The CI repair implements login input validation, controlled quote validation errors and the three upload protections below. Other production work packages in #26 remain outside this change.

## Contract migration and review follow-up

| Area | Current checks and reason |
| --- | --- |
| Retired APIs | `POST /api/orders` and `POST /api/paypal/capture-order` return exactly **410**, including anonymous callers, malformed provider IDs and forged payment fields. They cannot create orders, change inventory or call PayPal. Active payment checks use persisted `checkoutId` values. |
| Ownership and replay | Foreign checkout reads, confirmation, cancellation and completed/archived order reads return exactly **404**, disclose no customer details and cannot call the provider. Owned confirmation and archived replay succeed even when PayPal payer email differs from the local owner. Profile-update authorization retains its separate 403 contract. |
| Trusted checkout snapshot | Standard, express and FOXPOST requests cannot override the local buyer, product fields, prices, HUF currency, PayPal method or paid status. A changed displayed total returns `QUOTE_CHANGED` before payment or reservation. Invalid checkout inputs are rejected before persistence/provider side effects. |
| Provider evidence | Wrong merchant, order ID, currency, amount or checkout reference enters **REVIEW** before capture/reservation. Pending or incomplete capture evidence cannot produce a paid order; the uncertain reservation stays held. A **202** recovery/review response is not payment success. |
| Durable payment/idempotency | Real MongoDB indexes, transactions and Mongoose validation run through the production Express app. Concurrent confirmations and owned/archived replays produce one schema-valid order, one capture and one inventory decrement. A provider-create response without an ID retains a recoverable attempt and reuses its persisted request identity. |
| FOXPOST changes on master | An ineligible selected point in an otherwise usable directory returns **400**. An empty or entirely ineligible directory returns **503**, with no provider creation, checkout attempt or stock change. The extracted app retains the shipping router. |
| Login credential shapes | Operator/array email and object/array password return **400**, no token and zero `User.findOne` calls. The route now validates both fields as nonempty strings before persistence. The fixture uses a real User and bcrypt hash. |
| Quote validation | Unsupported string/object shipping methods return controlled **400** responses without payment/inventory effects. Pricing assigns a client-error status rather than producing a 500. |
| Upload policy | The three implementation gates now execute HTTP/filesystem checks: expired download denial and cleanup, concurrent uploads across two independent app processes sharing a directory, and an interrupted multipart upload followed by successful quota reuse. Retention also preserves active reservations. |
| XSS and CI | Actual admin DOM rendering is checked with image-handler, script and SVG-handler payloads in customer fields, description, notes and filenames. GitHub Actions continues to run the full server and full client suites in separate jobs. |

## Reproduction

```sh
npm ci
npm run test:server
npm run test:server:security
npm run test:server:coverage
npm ci --prefix client
npm run test --prefix client -- --watchAll=false --runInBand
```

On Windows PowerShell use `npm.cmd` if script execution is disabled. All server commands use the portable file-discovery runner rather than shell globs. `--security` includes security, custom-order, auth-middleware, checkout, inventory-race, PayPal and FOXPOST files. `--coverage` enables Node's test coverage mode and preserves failing exit status.

The payment integration suite starts an isolated local `MongoMemoryReplSet`; it does not connect to the application database. The MongoDB binary must be available in the cache or downloadable on first use. Real JWT verification, models, indexes, transactions, pricing and payment validation execute normally. Only external PayPal/FOXPOST transport is replaced. Login/authorization tests retain scoped repository fixtures. Existing custom-order checks use temporary upload directories and real multipart/filesystem operations; SMTP is mocked. No real customer database, payment or mail service is used.

## Local evidence

Verification on **2026-10-07**, Windows, Node **22.23.0**, rebased onto master **`a291c85`**:

| Run | Passed | Failed | Skipped/todo | Exit code |
| --- | ---: | ---: | ---: | ---: |
| Immediately after rebase, before adapting old QA contracts | 166 | 44 | 3 todo | 1 |
| Updated full server suite with coverage | 204 | 9 | 0 | 1 |
| Updated focused security suite | 185 | 9 | 0 | 1 |
| Full client suite, including XSS and checkout | 83 | 0 | 0 | 0 |

The pre-repair runs above had nine failures: four credential-shape checks, two quote-validation checks and three upload implementation gates. The repair replaces the upload blockers with executable behavior coverage and adds a configuration check. The full server suite now passes **214/214** with **zero failures, skips or todo tests**. The payment HTTP file passes all **39** checks. Verification used Windows and Node **22.23.0** on **2026-10-07**. The current log is `.test-artifacts/qa-fix-server.log`; these local results do not claim a new hosted CI run.

Full-suite coverage reports **95.01% lines, 92.13% branches and 94.70% functions** across loaded server files. Coverage is not evidence that the failing requirements are satisfied. Logs are stored locally under `.test-artifacts/qa-rebase-{coverage,security,client}.log`. Hosted CI requires publication of this branch; local results do not claim a hosted run.

For historical context, the previous QA evidence on 2026-10-04 reported 111 passing/35 failing server checks. Those numbers used the retired payment contract and must not be treated as the current result. Replacing retired-flow assertions with the new contract explains much of the change in failure counts; it is not a claim that this QA PR repaired production payment code.

## Coordination and limits

#24's implementation now supplies checkout ownership, durable payment recovery and inventory safety. The migrated QA checks retain those security outcomes instead of expecting creation/capture through retired endpoints or treating PayPal email as ownership.

#26 also describes broader parser/error sanitization, bearer syntax, upload filename, CORS/CSP and deployment hardening work. This rebase does not claim comprehensive new coverage or remediation for every item in that issue. The login fixture uses a matching account password and does not demonstrate passwordless login. DOM checks run in jsdom and are not a complete browser/CSP audit.

This payment HTTP file exercises concurrency against one local app and a real replica set. Additional checkout/inventory suites remain in both full and focused runs; that payment file does not itself simulate multiple app processes or restarts. Upload quota coverage separately starts two app processes sharing one upload directory.

## Upload storage policy

`CUSTOM_ORDER_STORAGE_QUOTA_MB` defaults to **1024 MiB** per shared upload directory. Each in-flight file reserves the full configured per-file maximum before writing, so an upload can receive **507** even if a smaller completed file would fit. After persistence, the reservation is released and the stored file counts by its actual size. Atomic filesystem directory locks serialize quota accounting across app processes using the same directory. All instances must share the same quota policy and filesystem; separate upload volumes have separate quotas.

`CUSTOM_ORDER_FILE_RETENTION_DAYS` defaults to **30 days**. New file records persist their expiry; legacy records use order creation time plus the current retention duration. Expired admin downloads return **404** and remove the file. A startup/hourly sweep and pre-upload sweep remove expired generated model files using their filesystem modification time plus the current retention duration. Active reservations and unrelated files are preserved. Order/contact records remain; metadata can still describe an expired file whose download is denied. Backups/restores should preserve modification times.

Interrupted streams, malformed multipart bodies, invalid models, input-validation failures and database-create failures delete their partial file and release capacity. SMTP failure preserves the accepted file. A process crash can leave a reservation or `.quota-lock`; these deliberately fail closed rather than automatically stealing capacity from a potentially live upload. For recovery, stop all instances sharing the directory, inspect `.quota-reservation-*` records and their named files, remove orphan partial files/reservations and an abandoned lock, then restart. Do not delete an accepted order's file merely because its reservation survived a crash. A lock busy for two seconds returns **503**.
