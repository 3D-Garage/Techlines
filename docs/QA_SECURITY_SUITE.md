# Security QA and PR #25 review fixes

This QA change addresses the comments on [PR #25](https://github.com/3D-Garage/Techlines/pull/25). The checks exercise the current HTTP API and deliberately fail when a required security outcome is absent. A failing check must not be weakened, skipped, or changed to `todo` to make the release look ready.

## Review decisions

| Comment | Assessment and change |
| --- | --- |
| Upload requirements were `test.todo` and allowed a green release gate. | Valid. The three requirements are now ordinary, explicitly failing tests in `securityRequirements.test.js`, using the review's permitted alternative of blocking the release until implementation. These are blockers, **not** executable retention/quota/abort behavior coverage. |
| The NoSQL mock hid invalid credentials reaching `User.findOne`. | Valid. Separate operator/array email and object/array password tests require HTTP 400, no token and zero repository queries. The repository returns a real User with a real bcrypt password hash rather than neutralizing the selector. |
| Payment confirmation lacked a cross-user replay regression. | Valid. Real HTTP checks exercise existing order-ID and capture-ID replay branches and assert denial, no customer data disclosure, no order save and no stock write. Owned replays are covered separately. |
| Standalone capture lacked completed-status/currency/evidence checks. | Valid. Both capture and confirmation are exercised with pending capture status, USD, absent currency, absent capture ID, absent capture records and absent purchase units. The actual capture normalizer is used; invalid evidence must be rejected before persistence or stock changes. Standalone ownership and malformed IDs are also checked. |
| XSS coverage was absent. | Partly valid. The existing client test already checked literal rendering of an HTML payload and the mail test checked text-only notification output. Coverage is expanded with image-handler, script and SVG-handler payloads across admin detail/list customer fields, description, notes and the displayed filename. Tests inspect the actual rendered DOM for escaped text and absence of injected elements/event-handler attributes. A JSON response or security header alone does not demonstrate frontend XSS protection. |
| Shipping/payment combination validation lacked HTTP coverage. | Valid. Unsupported shipping is checked on order, quote and PayPal-create endpoints. Both supported shipping methods are tested with unsupported catalog payment methods. Rejection must precede order saving, stock writes and PayPal creation. |
| Successful payment idempotency existed only in handler tests. | Valid. An HTTP paid-confirmation/replay test asserts one valid saved order, one capture and one stock decrement. The save fixture executes actual Mongoose validation, exposing the current required-image defect instead of faking successful persistence. |
| The PR lacked independent CI execution. | A GitHub Actions workflow now runs server QA and client/XSS tests as separate jobs. The backend job is expected to fail until the release blockers are resolved. Actual hosted CI results require the changes to be pushed. |

## Reproduction

```sh
npm ci
npm run test:server
npm run test:server:security
npm run test:server:coverage
npm ci --prefix client
npm run test --prefix client -- --watchAll=false --runInBand CustomOrders.test.jsx
```

On Windows PowerShell use `npm.cmd` if script execution is disabled. The server runner discovers `.test.js` files without relying on shell glob expansion; `--security` selects security, custom-order and auth-middleware files. Coverage uses Node's test coverage mode.

No live MongoDB, PayPal or mail service is contacted. HTTP requests go to ephemeral localhost servers. Repository methods and PayPal transport calls are isolated; JWT verification, bcrypt comparison, pricing, capture normalization and the new save fixture's Mongoose validation execute normally. Existing custom-order tests use isolated temporary upload directories and real multipart parsing/filesystem operations.

## Local evidence

Verification on **2026-10-04**, Node **22.23.0**, based on PR head `946295963f0312f2104d52e08ebdc001bfef9cc3`:

| Run | Passed | Failed | Skipped/todo | Exit code |
| --- | ---: | ---: | ---: | ---: |
| Original full server suite | 107 | 0 | 3 todo | 0 |
| Updated full server suite | 111 | 35 | 0 | 1 |
| Focused security suite | 68 | 35 | 0 | 1 |
| Full server suite with coverage | 111 | 35 | 0 | 1 |
| Custom-order client suite, including XSS | 19 | 0 | 0 | 0 |

Coverage reports 91.98% lines, 87.91% branches and 90.79% functions across the files loaded by the server suite. Coverage percentages are not evidence that the failing security requirements are satisfied. `git diff --check` also passed. Hosted CI has not been run from these local changes.

The 35 failures consist of 32 failing behavior checks plus 3 explicit upload implementation blockers. They are not 35 distinct confirmed vulnerabilities. Passing preexisting checks remain active.

Observed failure groups:

- Invalid login credential shapes reach `User.findOne` instead of being rejected first.
- Both foreign order-ID and foreign capture-ID replay return another customer's stored order.
- A valid paid confirmation reaches actual schema validation with an empty required item image and fails before a successful HTTP replay can be checked.
- Standalone capture returns success for invalid capture evidence, calls PayPal for malformed IDs and does not verify ownership before capture.
- Confirmation permits absent currency/capture ID/capture records to reach order saving via normalization fallbacks. The subsequent image/schema failure does not make that verification safe.
- Unsupported shipping produces 500 rather than controlled 400 responses; unsupported payment methods reach stock writes/order saving.
- Upload expiry, atomic quota reservation and quota recovery after an aborted upload remain unimplemented release blockers.

## Coordination and limits

Payment implementation belongs to [#24](https://github.com/3D-Garage/Techlines/issues/24), and broader production remediation is tracked by [#26](https://github.com/3D-Garage/Techlines/issues/26). This PR strengthens QA and adds CI; it does not implement those production work packages.

The tests describe the current API contract. When #24 lands, replace tests of the retired `POST /api/orders` and `/api/paypal/capture-order` routes with controlled **410** assertions and zero payment/inventory side effects. Retain the security outcomes on the replacement flow, move confirmation to the persisted checkout contract, use its local owner rather than PayPal email equality, and require **404** for foreign resources. The current replay tests allow 403 or 404 denial; current capture ownership fixtures exercise the existing payer-based flow only.

The in-memory repository is not a MongoDB transaction/unique-index test. Its stock assertions exercise the disconnected inventory branch. Cross-process races, connected transaction rollback, persistence across restarts and unique-index behavior require #24's isolated MongoDB replica-set tests. The paid-order schema defect currently prevents later assertions in the successful-confirmation/replay test from running.

The NoSQL fixture uses a matching account password; it does not demonstrate passwordless login. DOM tests verify safe rendering in jsdom and are not a complete browser/CSP audit. The three upload blockers must be replaced with real HTTP/filesystem tests once production policy and mechanisms exist; they provide no evidence that retention/quota/abort behavior has been exercised.
