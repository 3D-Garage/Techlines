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

### Automated Windows setup

After cloning the repository, open PowerShell in the project directory and run:

```powershell
npm run setup:dev
```

The setup requires Node.js 18 or newer. It performs the following local-only steps:

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

The client runs on `http://localhost:3000` and proxies API requests to `http://localhost:5000`.

## Admin access

New accounts are customers by default. Set the selected user's `isAdmin` field to `true` in MongoDB, then sign in again to expose the Admin Console in the profile menu.

## Verification

```bash
npm run test:server
npm run build --prefix client
```
