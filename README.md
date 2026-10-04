# 3D Garage

A full-stack 3D-printing webshop built with React, Chakra UI, Redux Toolkit, Express and MongoDB.

## Features

- product catalogue, product details and shopping cart
- registration, login and editable customer profile
- PayPal checkout with server-side order creation and capture
- shipping address and standard/express delivery select
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

The generated admin credentials are printed at the end and stored in the local `.env`. PayPal checkout stays disabled until PayPal sandbox credentials are added. The setup preserves an existing `.env`; use `npm run setup:dev -- -Force` to back it up and generate a replacement.

### Manual setup

1. Install the root and client dependencies:

   ```bash
   npm install
   npm install --prefix client
   ```

2. Create a root `.env` file:

   ```env
   MONGO_URI=mongodb://127.0.0.1:27017/techlines
   TOKEN_SECRET=replace-with-a-long-random-secret
   PAYPAL_CLIENT_ID=your-paypal-sandbox-client-id
   PAYPAL_CLIENT_SECRET=your-paypal-sandbox-secret
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
npm run build --prefix client
```

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
| `CUSTOM_ORDER_UPLOAD_DIR` | Dedicated private, persistent directory containing only custom-order models. Defaults to `private-uploads/custom-orders`, resolved from the repository root. The frontend, public/build directories and Git metadata are rejected. |
| `CUSTOM_ORDER_MAX_FILE_SIZE_MB` | Maximum size of one model in MiB; defaults to 20, configurable above 0 through 100. Match reverse-proxy request limits accordingly. |
| `CUSTOM_ORDER_MAX_STORAGE_MB` | Aggregate upload storage limit in MiB; defaults to 1024 (1 GiB), must be at least the per-file limit. Existing files and maximum-size reservations for in-progress uploads count toward this limit. |
| `CUSTOM_ORDER_MAX_FILES` | Maximum number of stored files and in-progress uploads; defaults to 10,000, must be a positive integer. Bounds filesystem overhead and directory scans even for very small files. |
| `CUSTOM_ORDER_RETENTION_DAYS` | Model-file retention in days; defaults to 30, must be above 0. Expiry is based on the file's last modification time. Order records and attachment metadata remain in MongoDB. |
| `CUSTOM_ORDER_CLEANUP_INTERVAL_MINUTES` | Expired-file cleanup interval in minutes; defaults to 60, must be above 0. Cleanup also runs at API startup. |
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

Model files expire after the currently configured retention period in every order status,
including accepted, printing and completed requests. Changing retention also affects existing
files and legacy requests; shorten it only after checking which models are still needed.
Startup and periodic cleanup remove only regular files with application-generated UUID model
filenames, including abandoned files left by a stopped process. Cleanup does not remove fresh files
to make room. Expired models
cannot be downloaded, and the admin list and detail view show their expired status while keeping
the request and original attachment metadata. Admin expiry dates use the stored upload timestamp
(captured from the file's modification time), or the order creation date for legacy requests.
Admin responses also check whether the private file actually exists. A missing file stays
unavailable when retention is increased, including files deleted before this check was added.
Its original metadata remains visible, but its `expiresAt` is `null`; restoring availability
requires restoring the file itself. Filesystem access failures return an error rather than
being reported as deletion.
The customer form displays the retention period; keep backups under a separately managed
retention policy if copies must also expire there.

Run **one API process per upload directory**. Aggregate quota checks and in-progress reservations
are serialized within that process. Multiple API processes sharing a directory need a shared,
atomic quota/reservation store before deployment; shared disk storage alone is not sufficient.
The quotas include files already present on disk, and each active upload reserves one file slot
and the maximum per-file size until its order is saved. Each disk scan uses one reservation
snapshot for both reserved totals and disk exclusions, even if uploads finish during the scan.
Consequently, an upload can be rejected when less than one
maximum-size file of capacity remains even if that particular model is smaller. Keep disk space
available for other application data and monitor storage and cleanup failures. Unknown regular
files consume quota but are never automatically deleted. Unexpected subdirectories or symbolic
links block new uploads; inspect and resolve them before retrying.

| Endpoint | Access / behavior |
| --- | --- |
| `GET /api/custom-orders/config` | Public upload extensions, size limit and `fileRetentionDays`. |
| `POST /api/custom-orders` | Public; JSON for text-only requests or multipart with optional `modelFile`. |
| `GET /api/custom-orders?page=1&limit=20&status=new` | Admin; returns `{ orders, total, page, pages }`. Status filter is optional. |
| `GET /api/custom-orders/:id` | Admin; full request and delivery state, excluding private filesystem names. Attachment metadata includes `expiresAt`, `expired`, `available` and `missing`; the list and status-update responses use the same fields. |
| `GET /api/custom-orders/:id/file` | Admin; download as an opaque attachment, or HTTP 410 with `CUSTOM_ORDER_FILE_EXPIRED` / `CUSTOM_ORDER_FILE_MISSING` when expired / missing. |
| `PATCH /api/custom-orders/:id/status` | Admin; JSON with `status`, `adminNotes`, or both. |

The public fields are `customerName`, `customerEmail`, `customerPhone`, `description`,
`material`, `dimensions`, and `quantity`. Unexpected fields are rejected. Successful creation
returns HTTP 201 with `{ _id, status, createdAt }`. Validation errors return HTTP 400 with a
controlled message and field errors; oversized models return 413. Uploads exceeding aggregate
storage capacity return 503 with a controlled message; requests without a file remain available.
Submission attempts are limited to 10 per IP per 15 minutes before upload processing, using the app's existing
in-memory limiter. Multiple API instances require a shared rate-limit store in addition to the
shared storage and atomic quota store described above; configure trusted proxies explicitly for
your deployment before relying on client IPs.

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
Storage tests also cover concurrent reservations, aborted uploads, existing files, expiry,
periodic cleanup, file counts, symbolic links and failed deletions.
Client behavior tests can be run with `npm run test --prefix client -- --watchAll=false --runInBand`.

Library references: [Multer upload limits and storage](https://expressjs.com/en/resources/middleware/multer/)
and [Nodemailer SMTP configuration](https://nodemailer.com/smtp).

# techlines

[![CodeScene Code Health](https://codescene.io/projects/39261/status-badges/code-health)](https://codescene.io/projects/39261)
