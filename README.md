# 3D Garage

A full-stack 3D-printing webshop built with React, Chakra UI, Redux Toolkit, Express and MongoDB.

## Features

- product catalogue, product details and shopping cart
- registration, login and editable customer profile
- PayPal checkout with server-side order creation and capture
- shipping address and standard/express delivery selection
- product reviews (one review per customer and product)
- customer order history
- protected admin console for users, products, reviews and orders
- responsive light/dark 3D Garage interface

## Local setup

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
   PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
   PAYPAL_REQUEST_TIMEOUT_MS=10000
   PORT=5000
   ```

3. Start the API and React app together:

   ```bash
   npm run app
   ```

The client runs on `http://localhost:3000` and proxies API requests to `http://localhost:5000`.

Checkout confirmation uses MongoDB transactions, so MongoDB must run as a replica set (or a
sharded cluster). For local development, start `mongod` with `--replSet rs0`, run
`rs.initiate()` once in `mongosh`, and use the replica-set URI shown above. The API checks this
capability and required payment uniqueness indexes before it starts accepting requests.

## PayPal Sandbox verification

Use Sandbox REST credentials in the environment variables above and sign in with a Sandbox
buyer account from the checkout page. A successful approval calls only
`POST /api/orders/confirm` with the PayPal order ID; the server retrieves/captures the payment,
verifies its user binding, HUF amount and status, then creates the order and decrements stock in
one MongoDB transaction. The automated suite uses PayPal's Orders v2 Sandbox response shape;
the interactive buyer approval remains a credentialed Sandbox smoke test.

## Admin access

New accounts are customers by default. Set the selected user's `isAdmin` field to `true` in MongoDB, then sign in again to expose the Admin Console in the profile menu.

## Verification

```bash
npm run test:server
npm run build --prefix client
```
# techlines
[![CodeScene Code Health](https://codescene.io/projects/39261/status-badges/code-health)](https://codescene.io/projects/39261)
