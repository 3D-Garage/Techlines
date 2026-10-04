# Techlines Security Overview and Hardening Plan

This document describes the security measures currently implemented in the Techlines application and a prioritized TODO roadmap. It focuses on authentication, authorization, data handling, payments, server middleware, and operational safeguards.

## Scope and Threat Model

- Scope: Node/Express backend (`server/`), React frontend (`client/`), MongoDB via Mongoose, PayPal checkout flow.
- Trust assumptions: Backend is trusted. Frontend and network are untrusted. Attackers may tamper with any client-sent values and attempt replay/brute force.
- Goals: Protect user accounts and data, prevent payment/order tampering, limit abuse, and avoid secret leakage.

## Implemented Measures

- Custom printing requests

  - `server/routes/customOrderRoutes.js` requires admin authorization for listing, details, updates and file downloads. Public submissions are limited before multipart parsing to 10 per IP per 15 minutes.
  - Request fields are allowlisted, type/length checked, and normalized as literal text. Admin-only fields cannot be assigned publicly. React escapes displayed text; notification messages have no HTML body or attachments.
  - `server/services/customOrderNotification.js` validates sender, recipient and reply-to addresses, rejects header-control characters, and disables Nodemailer file and URL access. Customer content is used only as literal body text.
  - `server/middleware/customOrderUpload.js` accepts one STL/OBJ/STEP/STP model, checks format structure beyond the untrusted MIME/filename, limits bytes and multipart fields, and rejects executables and executable OBJ commands. This screening is not an antivirus or geometry validator.
  - UUID filenames are written outside web roots with restrictive filesystem modes. Rejected requests remove their uploads. Only authenticated attachment downloads expose files; downloads validate stored filenames and reject symlinks/path traversal.
  - `server/services/customOrderStorage.js` enforces a default aggregate limit of 1 GiB and 10,000 files. Existing regular files count toward both limits; each in-progress upload reserves a file slot and the full per-file allowance before writing. Quota decisions and cleanup are serialized within one API process per canonical upload directory. The stream also enforces the byte limit before writing to disk.
  - Oversized, invalid, aborted and database-rejected uploads remove partial files and release reservations. The upload middleware waits for asynchronous storage writes and removal callbacks to settle before forwarding a parser error, so a rejected request does not respond while its cleanup still holds quota. Failed deletions remain charged through the next disk scan. When capacity is unavailable, file submissions receive a controlled HTTP 503 response; text-only requests remain available.
  - Quota scans use a single reservation snapshot for both reserved totals and file exclusions. Releasing an upload reservation during an asynchronous directory/stat read cannot count both that reservation and its completed file.
  - Startup and hourly cleanup delete expired regular files with application-generated UUID model filenames after 30 days by default, based on filesystem modification time. Active uploads are excluded. Unknown filenames are never deleted; unexpected subdirectories or symbolic links block new uploads. Fresh files are not evicted to make room.
  - Retention applies to existing files and every order status. MongoDB order records and attachment metadata remain after file deletion. Admin responses expose expiry, expired downloads return HTTP 410, and the customer form explains retention when the API reports it. The frontend also accepts older configuration responses without retention metadata, without inventing a retention period; the updated backend must be restarted to activate the new storage protections. New records use the captured file modification time for expiry; legacy records use order creation time for the admin/download expiry check.
  - Admin list, detail and status-update responses check actual private-file availability and expose `available` and `missing` separately from policy expiry. Missing files have no future expiry date and remain unavailable after retention is increased, including historical deletions without a database marker. Downloads return HTTP 410 with a missing/expired code; the admin UI disables unavailable downloads. Permission and I/O failures return controlled errors instead of being treated as deletion.
  - Upload size and storage configuration are documented in `.env.example`. Persistent private storage must never be mounted by a static web server; Windows deployments should restrict its ACL to the application service account.
  - Database persistence precedes notification. Failed email never deletes an accepted request; delivery state is visible to admins, and logs avoid contact details, credentials and internal exception messages.
  - `server/__tests__/customOrder*.test.js` covers validation, upload screening and limits, unauthorized access, internal notes, rate limits, safe emails and failure retention, plus concurrent reservations, aborted uploads, quota recovery, expiry, periodic cleanup, canonical directory aliases and failed deletions.

- Authentication and session integrity

  - JWT verification middleware with user loading
    - File: `server/middleware/autMiddleware.js`
    - Verifies Bearer token using `TOKEN_SECRET` and attaches `req.user`, awaiting DB call and excluding password via `.select('-password')`.
    - On invalid/missing token, responds with `401` and a controlled error.
  - Token issuance
    - File: `server/routes/userRoutes.js`
    - Issues JWTs on login and registration (`genToken`). Current expiry is 60 days (see TODO for hardening).

- Authorization

  - Profile updates restricted
    - File: `server/routes/userRoutes.js`
    - Users may update only their own profile unless `isAdmin`. Unauthorized attempts return `403`.

- Input validation (basic) and error handling

  - Required fields checked on login/register
    - File: `server/routes/userRoutes.js`
  - Centralized error handling
    - File: `server/middleware/errorMiddleware.js` (notFound + errorHandler), mounted in `server/index.js`.
  - Async route wrappers to avoid unhandled promise rejections
    - File: `server/routes/productRoutes.js` uses `express-async-handler`.

- Rate limiting

  - In-memory rate limiter for sensitive endpoints
    - File: `server/middleware/rateLimit.js`
    - Applied to `/api/users/login` and `/api/orders` in `server/index.js`. Limits bursts to reduce brute force and abuse. (See TODO for production-grade replacement.)

- HTTP hardening and request limits

  - Body size limit: `express.json({ limit: '100kb' })` in `server/index.js` to mitigate large payload attacks.
  - Security headers (minimal, no external deps)
    - `X-Content-Type-Options: nosniff`
    - `X-Frame-Options: DENY`
    - `Referrer-Policy: no-referrer`
    - `X-XSS-Protection: 0` (modern guidance; prefer CSP — see TODO)
  - CORS control
    - `Access-Control-Allow-Origin` set from `CORS_ORIGIN` (defaults to `*`). (See TODO to restrict to known domains.)

- Data model fixes and consistency

  - User schema
    - File: `server/models/User.js` — `isAdmin` corrected to Boolean with default `false`.
  - Order schema
    - File: `server/models/Order.js` — `shippingAddress` field names fixed; `paymentMethod` default set to `"PayPal"`.

- Orders and integrity of identity

  - Server trusts identity from token, not client body
    - File: `server/routes/orderRoutes.js`
    - Ignores `userInfo` from the request body; derives `user`, `username`, `email` from `req.user` (populated by the middleware).
    - General order creation rejects client-supplied totals and payment-confirmation fields; prices and shipping fees are calculated server-side. Paid PayPal orders are created through `/api/orders/confirm`.

- PayPal payment flow (server-side)

  - Endpoints
    - File: `server/routes/paypalRoutes.js`
    - `POST /api/paypal/create-order` (protected): computes total server-side (using DB prices) and creates a PayPal order via REST API.
    - `POST /api/paypal/capture-order` (protected): performs server-side capture using REST API.
    - `GET /api/paypal/client-id` (public): returns the configured public SDK client ID; does not expose the client secret.
    - `POST /api/orders/confirm` (protected, `server/routes/orderRoutes.js`): receives `orderID`, fetches PayPal order details and captures the payment. Before creating a new paid order, it requires `COMPLETED` status, HUF currency and a captured amount matching server-recalculated product and shipping prices.
  - Service client
    - File: `server/services/paypalService.js`
    - Retrieves access token and calls PayPal `create/capture` APIs using environment credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, optional `PAYPAL_BASE_URL`).
  - Server-side total calculation (prevents client tampering)
    - `create-order` recalculates subtotal from product prices in DB + shipping, rounds in HUF, and sends that to PayPal.

- Frontend changes to enforce server mediation

  - File: `client/src/components/PayPalButton.jsx`
    - `createOrder`: calls server `POST /api/paypal/create-order` with `Authorization: Bearer <token>` and cart items.
    - `onApprove`: calls server `POST /api/orders/confirm` with only the PayPal `orderID`; the backend verifies payment and persists the paid order. The separate capture endpoint still exists, but this frontend flow does not call it.
    - Loads the public SDK client ID from `/api/paypal/client-id`.
  - File: `client/src/redux/actions/orderAction.js`
    - Adds `Authorization: Bearer <token>` to `/api/orders` POST.

- Operational
  - `PORT` variable fixed (`server/index.js` uses `process.env.PORT`).
  - Tests for critical paths using Node’s built-in test runner: `npm run test:server`.
    - Files: `server/__tests__/authMiddleware.test.js`, `server/__tests__/userRoutes.test.js`, `server/__tests__/orderRoutes.test.js`, `server/__tests__/paypalRoutes.test.js`.

## Dependency Audit Snapshot

The dependency remediation and root lockfile audit on **2026-09-27** established the following baseline:

- Express was upgraded from **4.18.2 to 4.22.3** and Mongoose from **7.0.4 to 7.8.12**, retaining their existing major versions. `package.json` and `package-lock.json` both reflect the update. Vulnerable runtime transitives were also updated, including `jws` to 3.2.3, `jwa` to 1.4.2 and `lodash` to 4.18.1.
- The previous Mongoose and Express findings were package-level audit results. Exploitability through the custom-order endpoint was not established. An audit finding alone does not demonstrate an application-level exploit.
- No audit findings remained among the 109 dependency nodes reachable from the backend's imported runtime packages: `bcryptjs`, `dotenv`, `express`, `express-async-handler`, `jsonwebtoken`, `mongoose`, `multer`, `nodemailer` and `validator`. This is a dependency-graph comparison with the audit results, not a guarantee against unknown vulnerabilities.
- The **complete root audit is still not clean**: 54 findings remained (12 low, 13 moderate, 27 high, 2 critical), all reachable through the root `react-scripts` tooling dependency. These require separate remediation. They must not be presented as fixed by the server package updates, and this count is not a separate audit of `client/package-lock.json`.
- `react-scripts` is currently declared under root `dependencies`; therefore `npm audit --omit=dev` is not equivalent to checking only the backend runtime graph. Re-run audits of both lockfiles after dependency changes and as advisory data changes.

## Configuration and Secrets

- Required environment variables
  - `MONGO_URI`, `TOKEN_SECRET`, `PORT`
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, optional `PAYPAL_BASE_URL` (defaults to sandbox)
  - `CORS_ORIGIN` for allowed frontend origin
- Custom-order file storage (defaults; see [.env.example](.env.example) and [README.md](README.md#custom-3d-printing-orders))
  - `CUSTOM_ORDER_UPLOAD_DIR=private-uploads/custom-orders`: dedicated private directory, never statically served.
  - `CUSTOM_ORDER_MAX_FILE_SIZE_MB=20`: per-file limit in MiB.
  - `CUSTOM_ORDER_MAX_STORAGE_MB=1024`: total file bytes and in-progress reservations in MiB; must be at least the per-file limit.
  - `CUSTOM_ORDER_MAX_FILES=10000`: stored files plus in-progress reservations.
  - `CUSTOM_ORDER_RETENTION_DAYS=30`: file lifetime; changes also affect existing models in every order status.
  - `CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES=60`: cleanup interval; cleanup also runs before the API begins listening.
  - Restart the API after configuration changes. Keep the storage directory writable only by the service account.
- Client PayPal Client ID
  - The frontend obtains the public SDK client ID from `/api/paypal/client-id`, backed by `PAYPAL_CLIENT_ID`. `PAYPAL_CLIENT_SECRET` stays server-side. The legacy `client/src/client_id.js` path is ignored by Git and is not imported by the current frontend.

## Verified by Tests

- Auth middleware sets `req.user` on valid JWT and rejects missing/invalid tokens.
- Login returns token; duplicate registration rejected.
- Order creation uses `req.user` (token) rather than client-provided identity.
- PayPal routes: server computes totals from DB; confirmation rejects incomplete payments, non-HUF currency and captured-amount mismatches before creating a paid order.
- Custom-order storage: concurrent requests cannot overbook the configured quota within one API process; aborted and rejected uploads free reservations; existing files are counted; expired files are cleaned while order data remains; arbitrary filenames and symlinks are not deleted.
- Client configuration tests cover current and legacy API responses, malformed settings, failed loads and successful retries while preserving form input and enforcing file-size limits. The server's public configuration response is checked for its expected fields and retention value.
- `customOrderUploadLifecycle.test.js` gates real file creation/deletion to force the malformed-upload cleanup race. It checks that the error callback follows cleanup and that the next upload can immediately reuse the quota; this regression failed before the storage-lifecycle fix.
- Quota regressions release reservations during directory and stat reads and check both byte and file-count limits. Attachment regressions perform real cleanup at 30 days, raise retention to 60 days, and check list/detail/update/download responses, legacy metadata, files still present, filesystem access errors and disabled admin downloads.
- Last implementation verification: **120 server tests** and **34 custom-order client tests** passed; the client production build also succeeded. Server tests use real local HTTP/multipart requests and isolated files, with stubbed database/mail dependencies. These results do not establish a full browser-to-MongoDB/SMTP deployment test or multi-process quota enforcement.

## Remaining Risks and Considerations

- Rate limiting is an in-memory stopgap and not distributed; use a production-ready limiter.
- Upload quota reservations are also process-local. Run **one API process per upload directory**. Multiple processes sharing a directory require an atomic shared quota/reservation coordinator; shared disk alone does not enforce the aggregate limit.
- File quotas bound custom-order storage, not the entire filesystem or database. Leave headroom for filesystem overhead, logs, backups and other application data. Attackers can still consume the allowed quota and temporarily prevent new file submissions; text-only request records have no automatic retention policy.
- Cleanup runs only while the API is running and filesystem deletions can fail. Monitor cleanup errors and disk usage. Model retention does not delete MongoDB contact/order data or backup copies; those need their own retention policies.
- The root `react-scripts` dependency tree still has known audit findings, including high and critical findings; see the dated audit snapshot above.
- No comprehensive input validation schema yet (IDs, shapes, value ranges) — see TODO.
- CSP header is not set; current headers reduce some risk but do not prevent all XSS vectors.

## TODO Roadmap (Prioritized)

High priority

- Remediate the remaining `react-scripts` dependency-tree findings, including the high and critical findings in the audit snapshot; assess a maintained build toolchain and verify both root and client lockfiles after changes.
- Before running multiple API processes against shared uploads, implement atomic shared quota reservations alongside the shared rate-limit store.
- Replace in-memory rate limiter with `express-rate-limit` (or Redis-backed limiter) and add per-account lockout on repeated login failures.
- Add `helmet` for comprehensive, battle-tested security headers. Include a strong Content Security Policy (CSP) tailored to the app and PayPal SDK domains.
- Restrict CORS to explicit production/staging domains rather than `*`.
- Add robust input validation with `celebrate/Joi` or `express-validator` for:
  - Auth (email format, password policy)
  - Order and PayPal payloads (complete schemas, item-array bounds and shipping-address fields); product IDs, quantities and supported shipping methods already have server-side checks.
- Shorten JWT access token lifetime and introduce refresh token rotation, with server-side revocation (e.g., on password change/logout).

Medium priority

- Add PayPal webhooks for reconciliation (`PAYMENT.CAPTURE.COMPLETED`), signature verification, and idempotency handling.
- Implement role-based access control (RBAC) scaffolding for future admin endpoints.
- Add detailed audit logging and request correlation IDs; centralize logs.
- Improve error messages (do not leak internal details), standardize error responses.
- Preserve the custom-order notification address validation and literal-text-only policy when adding new notification types.

Low priority

- Password policy enforcement (minimum length, complexity, breach checks via k-Anonymity API).
- Add CSP report-only mode, then enforce; add security.txt.
- Add automated dependency scanning and runtime vulnerability alerts.
- Define retention and deletion policies for customer/order records, logs and backups; the implemented model-file retention policy does not cover these data stores.

## Operations & Deployment Notes

- Always run behind TLS (HTTPS) and terminate TLS at a trusted load balancer or reverse proxy.
- Keep `TOKEN_SECRET`, PayPal secrets, and `MONGO_URI` in a secure secret store (not in source control).
- Configure process restarts and health checks; in-memory limiter resets on restart.
- Use one API process per upload directory until shared atomic quota coordination is implemented. Restrict external writers so they cannot bypass upload accounting or change file modification times.
- Confirm the configured retention period before deployment: startup cleanup also applies to pre-existing models, including accepted and printing requests. Manage backup expiry separately.
- Monitor 4xx/5xx, rate-limit hits, unusual payment activity, file-storage capacity and cleanup failures.

## How to Run Tests

- Command: `npm run test:server`
- Tests use stubs/mocks; no live network or DB required.
- Custom-order client tests: `npm run test --prefix client -- --watchAll=false --runInBand CustomOrders.test.jsx`.
- Dependency checks: `npm audit` and `npm audit --prefix client`; the root audit currently reports the unresolved tooling findings described above.
