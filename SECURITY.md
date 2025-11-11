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

  - Server trusts identity from token, not client body
    - File: `server/routes/orderRoutes.js`
    - Ignores `userInfo` from the request body; derives `user`, `username`, `email` from `req.user` (populated by the middleware).

- PayPal payment flow (server-side)

  - Endpoints
    - File: `server/routes/paypalRoutes.js`
    - `POST /api/paypal/create-order` (protected): computes total server-side (using DB prices) and creates a PayPal order via REST API.
    - `POST /api/paypal/capture-order` (protected): performs server-side capture using REST API.
  - Service client
    - File: `server/services/paypalService.js`
    - Retrieves access token and calls PayPal `create/capture` APIs using environment credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, optional `PAYPAL_BASE_URL`).
  - Server-side total calculation (prevents client tampering)
    - `create-order` recalculates subtotal from product prices in DB + shipping, rounds in HUF, and sends that to PayPal.

- Frontend changes to enforce server mediation

  - File: `client/src/components/PayPalButton.jsx`
    - `createOrder`: calls server `POST /api/paypal/create-order` with `Authorization: Bearer <token>` and cart items.
    - `onApprove`: calls server `POST /api/paypal/capture-order` with the PayPal `orderID`, then triggers app order creation.
  - File: `client/src/redux/actions/orderAction.js`
    - Adds `Authorization: Bearer <token>` to `/api/orders` POST.

- Operational
  - `PORT` variable fixed (`server/index.js` uses `process.env.PORT`).
  - Tests for critical paths using Node’s built-in test runner: `npm run test:server`.
    - Files: `server/__tests__/authMiddleware.test.js`, `server/__tests__/userRoutes.test.js`, `server/__tests__/orderRoutes.test.js`, `server/__tests__/paypalRoutes.test.js`.

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
- Order creation uses `req.user` (token) rather than client-provided identity.
- PayPal routes: server computes totals from DB; capture returns structured payload.

## Remaining Risks and Considerations

- Rate limiting is an in-memory stopgap and not distributed; use a production-ready limiter.
- No comprehensive input validation schema yet (IDs, shapes, value ranges) — see TODO.
- CSP header is not set; current headers reduce some risk but do not prevent all XSS vectors.
- Server does not yet verify that stored order totals exactly match PayPal captured amounts; the flow is split between payment capture and DB order creation.
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
- Move order creation fully server-side after PayPal capture:
  - New endpoint: `POST /api/orders/confirm-from-capture` takes `orderID` only, recomputes totals from DB, fetches PayPal capture details, verifies amounts and status (`COMPLETED`), then persists the order (`paidAt`, `paymentDetails`).
  - Reject if totals mismatch or capture is not completed.
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
