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
  - `server/middleware/customOrderUpload.js` accepts one STL/OBJ/STEP/STP model, checks format structure beyond the untrusted MIME/filename, limits bytes and multipart fields, and rejects executables and executable OBJ commands. This screening is not an antivirus or geometry validator.
  - UUID filenames are written outside web roots with restrictive filesystem modes. Rejected requests remove their uploads. Only authenticated attachment downloads expose files; downloads validate stored filenames and reject symlinks/path traversal.
  - Upload size and storage configuration are documented in `.env.example`. Persistent private storage must never be mounted by a static web server; Windows deployments should restrict its ACL to the application service account.
  - Database persistence precedes notification. Failed email never deletes an accepted request; delivery state is visible to admins, and logs avoid contact details, credentials and internal exception messages.
  - `server/__tests__/customOrder*.test.js` covers validation, upload screening and limits, unauthorized access, internal notes, rate limits, safe emails and failure retention.

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

- Catalog orders and PayPal integrity

  - [Checkout security and rollout](docs/CHECKOUT_SECURITY.md) documents the secured catalog flow and acceptance checks.
  - Owner-scoped durable checkout attempts freeze server-priced items, required images and the validated webshop address before payment. Identical requests replay safely; changed content under the same key returns 409.
  - Unpaid order creation and standalone capture endpoints return 410. Confirmation and status reads enforce local ownership with 404 for foreign IDs.
  - Provider approval precedes transactional stock reservation. Verified merchant/order/checkout references, exact HUF amount and COMPLETED capture/order precede transactional finalization. Admin delivery requires linked completed checkout evidence.
  - Persisted fenced leases and PayPal request IDs coordinate concurrent/restarted requests. Provider lookup precedes capture retries; uncertain outcomes retain inventory. REVIEW is query-only after the 30-minute capture retry budget, checked every five minutes.
  - Orders/products are archived. Versioned admin stock updates conflict on stale edits. Checkout is disabled without transaction support, required indexes and complete payment configuration.
  - Frontend persists creation identity and active checkout by user, resumes polling after reload, hides payment starts while pending and clears the cart only after verified completion. Personal payment/order console logs are removed.

- Operational
  - `PORT` variable fixed (`server/index.js` uses `process.env.PORT`).
  - Tests for critical paths using Node’s built-in test runner: `npm run test:server`.
    - Files: `server/__tests__/authMiddleware.test.js`, `server/__tests__/userRoutes.test.js`, `server/__tests__/orderRoutes.test.js`, `server/__tests__/paypalRoutes.test.js`.

## Configuration and Secrets

- Required environment variables
  - `MONGO_URI`, `TOKEN_SECRET`, `PORT`
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID`, optional `PAYPAL_BASE_URL` (defaults to sandbox)
  - `CORS_ORIGIN` for allowed frontend origin
- The public PayPal client ID is fetched from `/api/paypal/client-id`. The client secret is server-only.

## Verified by Tests

- Auth middleware sets `req.user` on valid JWT and rejects missing/invalid tokens.
- Login returns token; duplicate registration rejected.
- Isolated real MongoDB replica-set tests cover ownership, concurrency, durable payment recovery, validation, stock release, archival and startup index collisions.
- Frontend and production-build browser tests cover pending/reload recovery and the saved webshop address. See the checkout document for commands and the separate live Sandbox acceptance procedure.

## Remaining Risks and Considerations

- Rate limiting is an in-memory stopgap and not distributed; use a production-ready limiter.
- No comprehensive input validation schema yet (IDs, shapes, value ranges) — see TODO.
- CSP header is not set; current headers reduce some risk but do not prevent all XSS vectors.

## TODO Roadmap (Prioritized)

High priority

- Replace in-memory rate limiter with `express-rate-limit` (or Redis-backed limiter) and add per-account lockout on repeated login failures.
- Add `helmet` for comprehensive, battle-tested security headers. Include a strong Content Security Policy (CSP) tailored to the app and PayPal SDK domains.
- Restrict CORS to explicit production/staging domains rather than `*`.
- Add robust input validation with `celebrate/Joi` or `express-validator` for:
  - Auth (email format, password policy)
  - Order payloads (ObjectId validation, qty ranges, shipping fields)
  - PayPal endpoints (items array schema, shippingPrice numeric bounds)
- Shorten JWT access token lifetime and introduce refresh token rotation, with server-side revocation (e.g., on password change/logout).

Medium priority

- Add PayPal webhooks for reconciliation (`PAYMENT.CAPTURE.COMPLETED`), signature verification, and idempotency handling.
- Implement role-based access control (RBAC) scaffolding for future admin endpoints.
- Add detailed audit logging and request correlation IDs; centralize logs.
- Improve error messages (do not leak internal details), standardize error responses.
- Validate and sanitize outbound emails/notifications (if added later).

Low priority

- Password policy enforcement (minimum length, complexity, breach checks via k-Anonymity API).
- Add CSP report-only mode, then enforce; add security.txt.
- Add automated dependency scanning and runtime vulnerability alerts.
- Document data retention and privacy policy (GDPR considerations for EU users).

## Operations & Deployment Notes

- Always run behind TLS (HTTPS) and terminate TLS at a trusted load balancer or reverse proxy.
- Keep `TOKEN_SECRET`, PayPal secrets, and `MONGO_URI` in a secure secret store (not in source control)!!!!!
- Configure process restarts and health checks; in-memory limiter resets on restart.
- Monitor 4xx/5xx, rate-limit hits, and unusual payment activity. This might be overkill

## How to Run Tests

- Command: `npm run test:server`
- The suite combines unit stubs and an isolated real MongoDB replica set; it does not use the application database or live PayPal. First setup may download the test MongoDB binary. Browser and explicit Sandbox checks are documented in [CHECKOUT_SECURITY.md](docs/CHECKOUT_SECURITY.md).
