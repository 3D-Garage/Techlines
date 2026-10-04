# Catalog checkout security and rollout

Catalog purchases use PayPal only. Custom 3D requests remain a separate workflow;
their cash-on-delivery quote/acceptance/payment tracking is a later development stage.
This package does not establish production readiness for the entire application.

## API and persistence

| Endpoint | Behavior |
| --- | --- |
| `POST /api/paypal/create-order` | Authenticated. Body: `requestId`, `items: [{productId, qty}]`, `shippingMethod: standard/express`, `shippingAddress: {address, city, postalCode, country}`. Returns `{checkoutId, id, status}`; 202 if preparation is pending. |
| `POST /api/orders/confirm` | Authenticated owner. Body: `{checkoutId}`. Returns the paid order on 200, checkout status on 202, terminal failure/expiry on 409. A client PayPal order ID is never used. |
| `GET /api/checkout/:id` | Owner only; foreign IDs return 404, including completed and archived-order retries. Returns status, frozen address/amount and completed order. |
| `GET /api/checkout/admin/pending` | Admin only; lists CREATING, PROCESSING and REVIEW attempts. |
| `POST /api/checkout/:id/reconcile` | Admin only; queries provider evidence. Cannot manually mark paid or initiate a capture. |
| `POST /api/orders`, `POST /api/paypal/capture-order` | Retired; 410 without stock/payment mutation. |
| `DELETE /api/orders/:id`, `DELETE /api/products/:id` | Admin archive; records and payment keys remain. |
| `PUT /api/products/:id` | Admin update must include the last read `inventoryVersion`; concurrent reservation/release/edit/archive makes stale writes return 409. |

Countries are ISO two-letter codes (e.g. HU); Hungarian postal codes have four digits.
The server aggregates duplicate items, reads names/images/prices from the catalog and
stores integer HUF amounts, shipping cost and the validated webshop address. It validates
the complete future Order schema before provider creation and again before reservation.
Client prices, payment statuses and provider IDs are ignored.

The owner-scoped request key is bound to normalized items/shipping/address. A changed
payload with the same key returns 409. Identical retries reuse the snapshot despite later
price changes or archival. Quotes are valid for 30 minutes; an approved, started payment
keeps its frozen amount. PayPal receives the address using SET_PROVIDED_ADDRESS and an
item_total/shipping breakdown. Payer email does not establish local ownership.

## State, stock and recovery

`CheckoutAttempt` stores creation/capture UUID request IDs, owner, merchant ID, quote,
validated order snapshot, provider IDs, reservation state and a fenced 120-second lease.
Only provider-verified APPROVED orders can reserve inventory. The reservation and
PROCESSING state commit in one MongoDB transaction; the subsequent capture happens outside
that transaction. Final order insertion and COMPLETED/CONSUMED state commit atomically,
without another stock decrement.

A paid order requires the expected provider order ID, CAPTURE intent, a single purchase
unit, matching checkout reference/custom ID and merchant ID, exact HUF amount, a single
COMPLETED capture and COMPLETED order status. Absent fields never receive success defaults.
Only orders linked to this completed checkout evidence can be marked delivered. Legacy
pending or unverifiable orders are never automatically upgraded.

Startup and a minute timer reconcile pending attempts, always looking up the provider
order before any capture retry. Creation/capture retries reuse the persisted PayPal-Request-Id.
Automatic capture retries stop 30 minutes after processing begins; REVIEW performs only
GET requests every five minutes, including when provider lookups fail. A timeout, unknown
capture, provider mismatch or local persistence failure preserves stock. A verified
declined/failed capture or voided order without captures releases held stock exactly once
in a transaction. Elapsed time alone never releases held stock.

The browser persists the request before creation and retains the checkout ID by local
user ID. After reload it resumes polling, hides new payment starts while pending and clears
only the purchased quantities after a completed paid order response. Other products and
additional quantities stay in the cart. Completion callbacks are consumed once even if
confirmation and polling both report success. Creation and status responses include the
saved quote so the summary, item quantities and shipping controls display the frozen
checkout during preparation and recovery. Shipping and quantity edits are disabled for
that prepared payment; resuming with different input is rejected.

Pre-creation input, inventory and order-schema validation failures return
`creationRejected: true`. The browser clears an uncreated attempt on this explicit signal,
including during reload recovery, so a corrected checkout gets a new request ID. A generic
404/409, authorization failure, database/provider error or timeout retains the original
request identity. A request-key conflict never carries the rejection signal, and an
already known checkout ID is never discarded on a creation-rejection error.
Payment/order responses are not logged to the console.

PayPal documents its idempotency behavior in the [idempotency guide](https://developer.paypal.com/api/rest/reference/idempotency/)
and the [Orders create reference](https://developer.paypal.com/sdk/orders/v2/orders-create/).
The latter documents a default six-hour request-key retention; the application's automatic
retry budget is deliberately shorter. Shipping configuration follows the
[Orders request reference](https://developer.paypal.com/sdk/orders/v2/definitions/order_request).

## Coordinated rollout

1. Back up MongoDB and verify restore before modifying the deployment. Keep existing orders
   and products; do not delete legacy unpaid orders or fabricate capture evidence.
2. Configure a MongoDB replica set (a single-node replica set is sufficient for local
   transactions) or a sharded cluster, and use a matching `MONGO_URI`. Standalone MongoDB
   still supports unrelated app features, but catalog payment remains disabled.
3. Configure matching `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_MERCHANT_ID` and
   `PAYPAL_BASE_URL`. Use Sandbox credentials with the Sandbox URL for acceptance testing.
4. Stop traffic to old checkout clients/API workers and deploy backend and rebuilt frontend
   together. Old checkout payloads/endpoints are incompatible with the secured flow.
5. On backend startup, initialization scans all proposed unique payment keys for duplicates
   before adding indexes. It never drops indexes or rewrites records. Duplicate keys or
   index/transaction/configuration failures disable catalog checkout with 503; investigate
   and resolve collisions manually with provider evidence before restarting.
6. Initialization creates/verifies Order keys (`paypalOrderId`, `paypalCaptureId`,
   `checkoutId`) and CheckoutAttempt keys (`user + requestId`, `paypalOrderId`,
   `paypalCaptureId`) and the reconciliation index. A no-op transactional write verifies
   database transaction permissions before checkout is enabled.
7. Run the verification commands below and complete a real Sandbox purchase before rollout.
   Watch the admin pending-payments tab and provider dashboard for REVIEW attempts. Admin
   recheck does not resolve a mismatch by bypassing evidence.

Never run `syncIndexes` or destructive migrations to fix collisions automatically.
The schema's payment indexes have automatic creation disabled until this preflight runs.

## Verification

```bash
npm run test:server
npm test --prefix client -- --watchAll=false --runInBand
npm run build --prefix client
npm run test:browser
npm run test:paypal:sandbox
```

The backend suite includes an isolated real MongoDB replica set managed by
mongodb-memory-server (no application database access). First installation may download
the MongoDB executable. It covers ownership, archived retries, validation, last-item races,
duplicate items, transaction rollback, lost create/capture responses, post-capture database
failure, restart/lease recovery, decline/uncertainty, timeout review, stale admin edits and
startup collision preflight. The browser suite serves the production build and uses a
deterministic PayPal SDK/API adapter to exercise actual React callbacks, 202 state, saved
address, reload, polling and cart preservation/clearing. Windows uses installed Chrome;
on Linux install Chromium with `npx playwright install chromium` first.

The explicit Sandbox check creates a temporary replica set and a 2,490 HUF purchase.
It prints the Sandbox approval link, waits for a Sandbox buyer to approve, then verifies
the actual provider capture, real order validation, frozen address and idempotent stock/order.
Direct approval links include return/cancel URLs pointing to a temporary local receipt
server. API success is reported separately as API_PASS; full PASS also requires the browser
to return and display the verified success receipt. The receipt server stays available for
up to one minute after capture while waiting for this acknowledgment.
It refuses the live PayPal API and never connects to the application's MONGO_URI.
Without all three PayPal settings and buyer approval, full Sandbox acceptance remains unverified.

On 2026-10-04 the isolated actual PayPal Sandbox API check passed: a COMPLETED 2,490 HUF
capture, schema-valid paid order, saved webshop address and a repeated confirmation without
another order or stock decrement. A fresh provider lookup confirmed order 4PL59417764726540
and capture 32F30787FA721350B, amount 2490.00 HUF, both COMPLETED. However, the buyer saw a
PayPal error page after approval: the original direct-link test omitted return_url.
This does not establish successful browser return or full manual browser acceptance.
The test helper now supplies return/cancel URLs and checks browser receipt separately;
that corrected end-to-end Sandbox flow still needs a new buyer-approved run. No application
database was used for these checks.

Next stages before production: revocable sessions/password fixes/admin MFA; custom-order
cash-on-delivery accounting; upload total quotas/load/retention and required SMTP TLS;
Linux VPS HTTPS/proxy/CSP/dependency checks, monitoring and exercised backup/restore.
