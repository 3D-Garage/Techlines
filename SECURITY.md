# Techlines Security Overview and Hardening Plan

This document describes the security measures currently implemented in the Techlines application and a prioritized TODO roadmap. It focuses on authentication, authorization, data handling, payments, server middleware, and operational safeguards.

## Scope and Threat Model

- Scope: Node/Express backend (`server/`), React frontend (`client/`), MongoDB via Mongoose, PayPal checkout flow.
- Trust assumptions: Backend is trusted. Frontend and network are untrusted. Attackers may tamper with any client-sent values and attempt replay/brute force.
- Goals: Protect user accounts and data, prevent payment/order tampering, limit abuse, and avoid secret leakage.

## Implemented Measures

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

  - Direct client-created orders are rejected. `POST /api/orders/confirm` accepts only a PayPal order ID.
  - The authenticated user, item snapshots, address, shipping method, server price, and total are persisted in a `CheckoutSession` before PayPal order creation.
  - Confirmation derives user identity from `req.user` and every order/payment field from the trusted checkout snapshot or verified PayPal response.
  - PayPal order IDs, capture IDs, and checkout session IDs have enforced unique indexes.

- PayPal payment flow (server-side)

  - Endpoints
    - File: `server/routes/paypalRoutes.js`
    - `POST /api/paypal/create-order` (protected): validates products, quantities, availability, stock, address, and shipping method; computes the HUF total and stores a user-bound checkout snapshot.
    - File: `server/routes/orderRoutes.js`
    - `POST /api/orders/confirm` (protected): retrieves/captures PayPal, verifies ownership, status, capture ID, amount, and currency, then creates the order and decrements stock transactionally.
  - Service client
    - File: `server/services/paypalService.js`
    - Retrieves access tokens and calls PayPal create/get/capture APIs with timeouts and stable `PayPal-Request-Id` values.
  - Server-side total calculation (prevents client tampering)
    - `create-order` calculates subtotal and shipping exclusively from database prices and server policy. Confirmation uses the immutable server snapshot.

- Frontend changes to enforce server mediation

  - File: `client/src/components/PayPalButton.jsx`
    - `createOrder`: sends only product IDs/quantities, address, and shipping method.
    - `onApprove`: confirms with the PayPal order ID only; the browser never supplies payment or local-order fields.
  - File: `client/src/redux/actions/orderAction.js`
    - Calls the authenticated `/api/orders/confirm` endpoint with only `paypalOrderId`.

- Operational
  - `PORT` variable fixed (`server/index.js` uses `process.env.PORT`).
  - Tests for critical paths using Node’s built-in test runner: `npm run test:server`.
    - Database-backed checkout integration tests use a MongoDB replica set and PayPal Orders v2-shaped responses.

## Configuration and Secrets

- Required environment variables
  - `MONGO_URI`, `TOKEN_SECRET`, `PORT`
  - PayPal: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, optional `PAYPAL_BASE_URL` (defaults to sandbox)
  - `CORS_ORIGIN` for allowed frontend origin
- Client PayPal Client ID
  - `client/src/client_id.js` contains the JS SDK client ID. This is acceptable for the PayPal JS SDK, but ensure no sandbox account credentials are present in comments. See TODO to move to a safer config/CI injection and remove secrets from the repo.

## Verified by Tests

- Auth middleware sets `req.user` on valid JWT and rejects missing/invalid tokens.
- Login returns token; duplicate registration rejected.
- Forged direct order creation is rejected.
- Amount/currency mismatch, incomplete capture, ownership mismatch, unavailable items, and insufficient stock create no order and do not decrement stock.
- Sequential and concurrent confirmations create one order, make one capture call, and decrement stock once.
- A completed capture can be recovered after a simulated local transaction failure.

## Remaining Risks and Considerations

- Rate limiting is an in-memory stopgap and not distributed; use a production-ready limiter.
- No comprehensive input validation schema yet (IDs, shapes, value ranges) — see TODO.
- CSP header is not set; current headers reduce some risk but do not prevent all XSS vectors.
- PayPal and MongoDB cannot share one distributed transaction. A durable confirmation claim and same-ID recovery handle ambiguous capture/commit failures; webhooks and reconciliation remain recommended for operational recovery.
- MongoDB must be a replica set or sharded cluster for checkout transactions.
- `client_id.js` tracked in VCS; comments must not include any credentials; prefer environment injection.

## TODO Roadmap (Prioritized)

High priority

- Replace in-memory rate limiter with `express-rate-limit` (or Redis-backed limiter) and add per-account lockout on repeated login failures.
- Add `helmet` for comprehensive, battle-tested security headers. Include a strong Content Security Policy (CSP) tailored to the app and PayPal SDK domains.
- Restrict CORS to explicit production/staging domains rather than `*`.
- Add robust input validation with `celebrate/Joi` or `express-validator` for:
  - Auth (email format, password policy)
  - Order payloads (ObjectId validation, qty ranges, shipping fields)
  - PayPal endpoints (items array schema, shippingPrice numeric bounds)
- Remove sensitive comments and decouple client PayPal ID:
  - Ensure `client/src/client_id.js` contains no sandbox credentials in comments.
  - Prefer build-time env injection for the PayPal client ID and ensure the file is not tracked or is generated.
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
- Tests use stubs/mocks; no live network or DB required.
