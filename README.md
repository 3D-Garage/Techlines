# 3D Garage

A full-stack 3D-printing webshop built with React, Chakra UI, Redux Toolkit, Express and MongoDB.

## Features

- product catalogue, product details and shopping cart
- registration, login and editable customer profile
- PayPal checkout with server-side order creation and capture
- shipping address and standard/express/FOXPOST locker delivery select
- product reviews (one review per customer and product)
- customer order history
- protected admin console for users, products, reviews and orders
- custom 3D printing requests with private model uploads, admin review and email notifications
- responsive light/dark 3D Garage interface

## Local setup

### Automated Windows setup

After cloning the repository, open PowerShell in the project directory and run:

```powershell
npm run setup:dev
```

The setup requires Node.js 20 or newer (including the SMTP mail dependency). It performs the following local-only steps:

- creates `.env` with a generated JWT secret and local admin password;
- installs MongoDB Community Server through Windows Package Manager if needed;
- starts the MongoDB Windows service;
- installs root and client npm dependencies;
- creates the MongoDB collections and indexes;
- seeds a local admin account and sample products.

The generated admin credentials are printed at the end and stored in the local `.env`. PayPal checkout stays disabled until PayPal Sandbox client credentials and PAYPAL_MERCHANT_ID are added and MongoDB is configured as a replica set. The setup preserves an existing `.env`; use `npm run setup:dev -- -Force` to back it up and generate a replacement.

`npm run app` watches backend source files and restarts the server when they change. Use `npm run server:dev` for the backend alone with automatic restart, or `npm run server` for a normal server process. If the checkout shows a newly added shipping method but the API returns `Unsupported shipping method` or a missing endpoint, restart an older backend process that was started before these changes.

### Manual setup

1. Install the root and client dependencies:

   ```bash
   npm install
   npm install --prefix client
   ```

2. Create a root `.env` file:

   ```env
   MONGO_URI=mongodb://127.0.0.1:27017/techlines?replicaSet=rs0
   TOKEN_SECRET=replace-with-a-long-random-secret
   PAYPAL_CLIENT_ID=your-paypal-sandbox-client-id
   PAYPAL_CLIENT_SECRET=your-paypal-sandbox-secret
   PAYPAL_MERCHANT_ID=your-paypal-sandbox-merchant-id
   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
   PORT=5000
   ```

3. Start the API and React app together:

   ```bash
   npm run app
   ```

> Inventory updates and order creation are executed in MongoDB transactions. For local development and CI, use a replica-set-capable MongoDB deployment (for example, MongoDB Atlas or a local `mongod --replSet rs0` setup). A standalone single-node MongoDB instance can be used for basic app development, but it is not sufficient for transaction-based stock enforcement tests.

The client runs on `http://localhost:3000` and proxies API requests to `http://localhost:5000`.

## Admin access

New accounts are customers by default. Set the selected user's `isAdmin` field to `true` in MongoDB, then sign in again to expose the Admin Console in the profile menu.

## Verification

```bash
npm run test:server
npm test --prefix client -- --watchAll=false --runInBand
npm run build --prefix client
npm run test:browser
```

FOXPOST locker checkout with manual parcel dispatch is documented in [FOXPOST checkout](docs/FOXPOST.md), including the directory API, recovery behavior and live widget acceptance check.

Catalog checkout uses a durable, owner-bound payment attempt, frozen server prices/address,
transactional inventory reservation and restart reconciliation. Old unpaid/capture endpoints
return 410. See [checkout API, rollout and Sandbox acceptance](docs/CHECKOUT_SECURITY.md)
for required indexes, replica-set configuration, pending-payment administration and
`npm run test:paypal:sandbox`. Deploy the frontend and backend together.

## Custom 3D printing orders

Customers can open **Egyedi megrendelés** in the navigation (`/custom-order`) without signing in.
Name, email and phone are required, together with a description or one model file. Material,
dimensions and quantity (1–10,000) are optional. Accepted files are ASCII/binary STL, OBJ,
and STEP/STP; the server checks content as well as the extension. This is format screening,
not geometry analysis, slicing or a malware scanner. Models are never automatically opened or executed.

The admin console links to `/admin/custom-orders`, with a paginated, status-filtered table,
request details, authenticated file download, internal notes and all seven statuses:
`new`, `review`, `quoted`, `accepted`, `printing`, `completed`, `rejected`.
Admins may select any listed status, including corrections to earlier states.

Copy the custom-order settings from `.env.example` into your local environment:

| Variable | Purpose |
| --- | --- |
| `CUSTOM_ORDER_UPLOAD_DIR` | Private, persistent storage. Defaults to `private-uploads/custom-orders`, resolved from the repository root. The frontend, public/build directories and Git metadata are rejected. |
| `CUSTOM_ORDER_MAX_FILE_SIZE_MB` | Maximum size of one model in MiB; defaults to 20, configurable above 0 through 100. Match reverse-proxy request limits accordingly. |
| `CUSTOM_ORDER_ADMIN_EMAIL` | One administrator email address for notifications. |
| `SMTP_HOST`, `SMTP_PORT` | SMTP server and port (default 587). |
| `SMTP_SECURE` | `true` for implicit TLS (typically port 465); default `false` uses STARTTLS when available. |
| `SMTP_USER`, `SMTP_PASS` | Optional authentication; provide both if needed. |
| `SMTP_FROM` | One valid sender email address authorized by your mail server. |
| `APP_BASE_URL` | Optional public frontend URL used for the admin detail link in email. |

Restart the API after changing configuration. No database migration is needed: Mongoose
creates the `customorders` collection and indexes; the development seed also initializes it.
Back up the private upload directory alongside MongoDB and persist it across deployments.
Never expose that directory through a static server. Downloads require the same admin bearer
authorization as the other admin APIs.

| Endpoint | Access / behavior |
| --- | --- |
| `GET /api/custom-orders/config` | Public upload extensions and size limit. |
| `POST /api/custom-orders` | Public; JSON for text-only requests or multipart with optional `modelFile`. |
| `GET /api/custom-orders?page=1&limit=20&status=new` | Admin; returns `{ orders, total, page, pages }`. Status filter is optional. |
| `GET /api/custom-orders/:id` | Admin; full request and delivery state, excluding private filesystem names. |
| `GET /api/custom-orders/:id/file` | Admin; download as an opaque attachment. |
| `PATCH /api/custom-orders/:id/status` | Admin; JSON with `status`, `adminNotes`, or both. |

The public fields are `customerName`, `customerEmail`, `customerPhone`, `description`,
`material`, `dimensions`, and `quantity`. Unexpected fields are rejected. Successful creation
returns HTTP 201 with `{ _id, status, createdAt }`. Validation errors return HTTP 400 with a
controlled message and field errors; oversized models return 413. Submission attempts are
limited to 10 per IP per 15 minutes before upload processing, using the app's existing
in-memory limiter. Multiple API instances require a shared rate-limit store and shared private
storage; configure trusted proxies explicitly for your deployment before relying on client IPs.

Requests are saved before email is attempted. Notifications are plaintext and include contact
information, print details, attachment presence and the request ID; model files are not emailed.
Missing SMTP settings, SMTP rejection and transport errors leave the request and file intact,
with a `failed` delivery state shown in the admin view and an order-ID-only log entry.
If recording delivery state fails or the process stops between saving and delivery, the request
can remain `pending`; review those requests in the admin table as well. Automatic notification
retry is not included.

The server tests exercise real multipart HTTP requests with isolated files and stubbed database
and mail dependencies. They cover contact validation, malicious/oversized uploads, cleanup,
admin authorization, downloads, status/notes, rate limits and notification failure retention.
Client behavior tests can be run with `npm run test --prefix client -- --watchAll=false --runInBand`.

Library references: [Multer upload limits and storage](https://expressjs.com/en/resources/middleware/multer/)
and [Nodemailer SMTP configuration](https://nodemailer.com/smtp).

# techlines

[![CodeScene Code Health](https://codescene.io/projects/39261/status-badges/code-health)](https://codescene.io/projects/39261)
