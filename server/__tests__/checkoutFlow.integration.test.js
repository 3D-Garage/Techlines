import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import CheckoutSession from "../models/CheckoutSession.js";
import Order from "../models/Order.js";
import Product from "../models/Product.js";
import {
  approvedPayPalOrder,
  checkoutBody,
  completedPayPalOrder,
} from "./fixtures/paypalCheckoutFixtures.js";
import { startCheckoutIntegrationHarness } from "./helpers/checkoutIntegrationHarness.js";

let harness;

before(async () => {
  harness = await startCheckoutIntegrationHarness();
});

beforeEach(async () => {
  await harness.reset();
});

after(async () => {
  await harness?.close();
});

const post = (path, token, body) => harness.request(path, { method: "POST", token, body });

const installApprovedCheckout = ({
  orderId,
  captureId = `CAPTURE-${orderId}`,
  captureStatus = "COMPLETED",
  captureAmount,
  captureCurrency,
  getCustomId,
} = {}) => {
  const calls = { create: [], get: [], capture: [] };
  let createInput;

  harness.setPayPalService({
    createOrder: async (input) => {
      calls.create.push(input);
      createInput = input;
      return { id: orderId, status: "CREATED" };
    },
    getOrder: async (requestedOrderId) => {
      calls.get.push(requestedOrderId);
      return approvedPayPalOrder({
        id: requestedOrderId,
        referenceId: createInput.referenceId,
        customId: getCustomId?.(createInput) ?? createInput.customId,
        amount: createInput.total,
        currency: createInput.currency,
      });
    },
    captureOrder: async (requestedOrderId, requestId) => {
      calls.capture.push({ orderId: requestedOrderId, requestId });
      return completedPayPalOrder({
        id: requestedOrderId,
        referenceId: createInput.referenceId,
        customId: createInput.customId,
        amount: createInput.total,
        currency: createInput.currency,
        captureId,
        captureStatus,
        captureAmount: captureAmount ?? createInput.total,
        captureCurrency: captureCurrency ?? createInput.currency,
      });
    },
  });

  return calls;
};

test("a PayPal Sandbox-shaped checkout persists only server-calculated values", async () => {
  const { user, token } = await harness.createUser();
  const product = await harness.createProduct({ price: 4000, stock: 10 });
  const calls = installApprovedCheckout({
    orderId: "SANDBOX-ORDER-SUCCESS",
    captureId: "SANDBOX-CAPTURE-SUCCESS",
  });

  const createResult = await post("/api/paypal/create-order", token, {
    ...checkoutBody(product._id),
    items: [
      {
        productId: String(product._id),
        qty: 2,
        name: "Forged product name",
        price: 1,
      },
    ],
    shippingPrice: 0,
    totalPrice: 2,
    paymentStatus: "COMPLETED",
    payerId: "CLIENT-CONTROLLED-PAYER",
  });

  assert.equal(createResult.response.status, 201);
  assert.deepEqual(createResult.payload, {
    id: "SANDBOX-ORDER-SUCCESS",
    subtotal: 8000,
    shippingPrice: 1490,
    totalPrice: 9490,
    total: 9490,
    currency: "HUF",
    quote: {
      subtotal: 8000,
      shippingPrice: 1490,
      totalPrice: 9490,
      currency: "HUF",
    },
  });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].total, 9490);
  assert.equal(calls.create[0].currency, "HUF");
  assert.equal(calls.create[0].customId, String(user._id));
  assert.match(calls.create[0].requestId, /^[0-9a-f-]{36}$/i);

  const checkout = await CheckoutSession.findOne({
    paypalOrderId: "SANDBOX-ORDER-SUCCESS",
  }).lean();
  assert.ok(checkout);
  assert.equal(calls.create[0].referenceId, String(checkout._id));
  assert.equal(checkout.items[0].name, product.name);
  assert.equal(checkout.items[0].price, 4000);
  assert.equal(checkout.shippingPrice, 1490);
  assert.equal(checkout.totalPrice, 9490);

  const confirmation = await post("/api/orders/confirm", token, {
    paypalOrderId: "SANDBOX-ORDER-SUCCESS",
  });

  assert.equal(confirmation.response.status, 201);
  assert.equal(confirmation.payload.user, String(user._id));
  assert.equal(confirmation.payload.orderItems[0].name, product.name);
  assert.equal(confirmation.payload.orderItems[0].price, 4000);
  assert.equal(confirmation.payload.orderItems[0].qty, 2);
  assert.equal(confirmation.payload.shippingPrice, 1490);
  assert.equal(confirmation.payload.totalPrice, 9490);
  assert.deepEqual(confirmation.payload.paymentDetails, {
    provider: "PayPal",
    orderId: "SANDBOX-ORDER-SUCCESS",
    captureId: "SANDBOX-CAPTURE-SUCCESS",
    status: "COMPLETED",
    amount: 9490,
    currency: "HUF",
    payerId: "SANDBOX-PAYER",
  });
  assert.equal(calls.get.length, 1);
  assert.deepEqual(calls.capture, [
    {
      orderId: "SANDBOX-ORDER-SUCCESS",
      requestId: checkout.paypalCaptureRequestId,
    },
  ]);

  const [storedOrder, storedCheckout, updatedProduct] = await Promise.all([
    Order.findById(confirmation.payload._id).lean(),
    CheckoutSession.findById(checkout._id).lean(),
    Product.findById(product._id).lean(),
  ]);
  assert.equal(storedOrder.paymentDetails.status, "COMPLETED");
  assert.ok(storedOrder.paidAt instanceof Date);
  assert.equal(storedCheckout.status, "COMPLETED");
  assert.equal(String(storedCheckout.order), String(storedOrder._id));
  assert.equal(updatedProduct.stock, 8);
});

for (const mismatch of [
  { name: "amount", captureAmount: 9491, captureCurrency: "HUF" },
  { name: "currency", captureAmount: 9490, captureCurrency: "USD" },
]) {
  test(`a mismatched captured ${mismatch.name} creates no order and changes no stock`, async () => {
    const { token } = await harness.createUser();
    const product = await harness.createProduct({ price: 4000, stock: 10 });
    installApprovedCheckout({
      orderId: `MISMATCH-${mismatch.name.toUpperCase()}`,
      captureId: `CAPTURE-MISMATCH-${mismatch.name.toUpperCase()}`,
      captureAmount: mismatch.captureAmount,
      captureCurrency: mismatch.captureCurrency,
    });

    const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));
    assert.equal(created.response.status, 201);

    const confirmed = await post("/api/orders/confirm", token, {
      paypalOrderId: created.payload.id,
    });

    assert.equal(confirmed.response.status, 422);
    assert.match(confirmed.payload.message, /captured amount or currency/i);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Product.findById(product._id).lean()).stock, 10);
  });
}

test("a capture that is not completed creates no order and changes no stock", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  installApprovedCheckout({
    orderId: "INCOMPLETE-CAPTURE-ORDER",
    captureId: "INCOMPLETE-CAPTURE",
    captureStatus: "PENDING",
  });

  const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));
  const confirmed = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });

  assert.equal(confirmed.response.status, 422);
  assert.match(confirmed.payload.message, /capture is not completed/i);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

test("repeated confirmation of a PayPal order is idempotent", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  const calls = installApprovedCheckout({
    orderId: "REPEATED-PAYPAL-ORDER",
    captureId: "REPEATED-PAYPAL-CAPTURE",
  });

  const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));
  const first = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });
  const second = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });

  assert.equal(first.response.status, 201);
  assert.equal(second.response.status, 200);
  assert.equal(second.payload._id, first.payload._id);
  assert.equal(calls.get.length, 1);
  assert.equal(calls.capture.length, 1);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(product._id).lean()).stock, 8);
});

test("concurrent confirmations make only one capture call and one local order", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  let createInput;
  let captureCalls = 0;

  harness.setPayPalService({
    createOrder: async (input) => {
      createInput = input;
      return { id: "CONCURRENT-PAYPAL-ORDER", status: "CREATED" };
    },
    getOrder: async () =>
      approvedPayPalOrder({
        id: "CONCURRENT-PAYPAL-ORDER",
        referenceId: createInput.referenceId,
        customId: createInput.customId,
        amount: createInput.total,
        currency: createInput.currency,
      }),
    captureOrder: async () => {
      captureCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return completedPayPalOrder({
        id: "CONCURRENT-PAYPAL-ORDER",
        referenceId: createInput.referenceId,
        amount: createInput.total,
        currency: createInput.currency,
        captureId: "CONCURRENT-CAPTURE",
      });
    },
  });

  const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));
  const firstRequest = post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  const secondRequest = post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });
  const [first, second] = await Promise.all([firstRequest, secondRequest]);

  assert.deepEqual(
    [first.response.status, second.response.status].sort((a, b) => a - b),
    [201, 409],
  );
  assert.equal(captureCalls, 1);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(product._id).lean()).stock, 8);

  const retry = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });
  assert.equal(retry.response.status, 200);
});

test("a completed capture is recoverable after a local transaction failure", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  let createInput;
  let captured = false;
  let captureCalls = 0;

  const completedOrder = () => {
    const order = completedPayPalOrder({
      id: "RECOVERABLE-PAYPAL-ORDER",
      referenceId: createInput.referenceId,
      amount: createInput.total,
      currency: createInput.currency,
      captureId: "RECOVERABLE-CAPTURE",
    });
    order.purchase_units[0].custom_id = createInput.customId;
    order.purchase_units[0].amount = {
      currency_code: createInput.currency,
      value: `${createInput.total}.00`,
    };
    return order;
  };

  harness.setPayPalService({
    createOrder: async (input) => {
      createInput = input;
      return { id: "RECOVERABLE-PAYPAL-ORDER", status: "CREATED" };
    },
    getOrder: async () =>
      captured
        ? completedOrder()
        : approvedPayPalOrder({
            id: "RECOVERABLE-PAYPAL-ORDER",
            referenceId: createInput.referenceId,
            customId: createInput.customId,
            amount: createInput.total,
            currency: createInput.currency,
          }),
    captureOrder: async () => {
      captureCalls += 1;
      captured = true;
      return completedOrder();
    },
  });

  const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));

  const originalUpdateOne = CheckoutSession.updateOne;
  CheckoutSession.updateOne = function (filter, update, options) {
    if (update?.$set?.status === "COMPLETED") {
      return Promise.reject(new Error("simulated local transaction failure"));
    }
    return originalUpdateOne.call(this, filter, update, options);
  };

  let failedConfirmation;
  try {
    failedConfirmation = await post("/api/orders/confirm", token, {
      paypalOrderId: created.payload.id,
    });
  } finally {
    CheckoutSession.updateOne = originalUpdateOne;
  }

  assert.equal(failedConfirmation.response.status, 500);
  assert.equal(captureCalls, 1);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);

  const checkout = await CheckoutSession.findOne({ paypalOrderId: created.payload.id });
  await CheckoutSession.collection.updateOne(
    { _id: checkout._id },
    { $set: { confirmationStartedAt: new Date(Date.now() - 61_000) } },
  );

  const recovered = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
  });
  assert.equal(recovered.response.status, 201);
  assert.equal(captureCalls, 1);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(product._id).lean()).stock, 8);
});

test("the same capture cannot back two different PayPal orders", async () => {
  const { token } = await harness.createUser();
  const firstProduct = await harness.createProduct({ name: "First item", stock: 10 });
  const secondProduct = await harness.createProduct({ name: "Second item", stock: 10 });

  installApprovedCheckout({
    orderId: "FIRST-PAYPAL-ORDER",
    captureId: "SHARED-CAPTURE-ID",
  });
  const firstCheckout = await post("/api/paypal/create-order", token, checkoutBody(firstProduct._id));
  const firstConfirmation = await post("/api/orders/confirm", token, {
    paypalOrderId: firstCheckout.payload.id,
  });
  assert.equal(firstConfirmation.response.status, 201);

  installApprovedCheckout({
    orderId: "SECOND-PAYPAL-ORDER",
    captureId: "SHARED-CAPTURE-ID",
  });
  const secondCheckout = await post("/api/paypal/create-order", token, checkoutBody(secondProduct._id));
  const secondConfirmation = await post("/api/orders/confirm", token, {
    paypalOrderId: secondCheckout.payload.id,
  });

  assert.equal(secondConfirmation.response.status, 409);
  assert.match(secondConfirmation.payload.message, /already been used/i);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal((await Product.findById(firstProduct._id).lean()).stock, 8);
  assert.equal((await Product.findById(secondProduct._id).lean()).stock, 10);
});

test("a forged direct order POST cannot create a paid order", async () => {
  const { user, token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });

  const result = await post("/api/orders", token, {
    user: user._id,
    orderItems: [
      {
        product_id: product._id,
        name: product.name,
        image: product.image,
        price: 1,
        qty: 2,
      },
    ],
    shippingPrice: 0,
    totalPrice: 2,
    paymentStatus: "COMPLETED",
    paymentDetails: {
      orderId: "FORGED-ORDER",
      captureId: "FORGED-CAPTURE",
      status: "COMPLETED",
    },
  });

  assert.equal(result.response.status, 405);
  assert.match(result.payload.message, /verified PayPal payment/i);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

test("order confirmation accepts only the PayPal order ID", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  const calls = installApprovedCheckout({ orderId: "STRICT-CONFIRMATION-ORDER" });
  const created = await post("/api/paypal/create-order", token, checkoutBody(product._id));

  const result = await post("/api/orders/confirm", token, {
    paypalOrderId: created.payload.id,
    totalPrice: 1,
    paymentStatus: "COMPLETED",
    payerId: "CLIENT-PAYER",
  });

  assert.equal(result.response.status, 400);
  assert.match(result.payload.message, /only .*PayPal order ID/i);
  assert.equal(calls.get.length, 0);
  assert.equal(calls.capture.length, 0);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

test("invalid quantities are rejected before PayPal payment creation", async () => {
  const { token } = await harness.createUser();
  const product = await harness.createProduct({ stock: 10 });
  let paypalCreateCalls = 0;
  harness.setPayPalService({
    createOrder: async () => {
      paypalCreateCalls += 1;
      return { id: "PAYPAL-SHOULD-NOT-BE-CREATED" };
    },
  });

  const result = await post("/api/paypal/create-order", token, {
    ...checkoutBody(product._id),
    items: [{ productId: String(product._id), qty: 1.5 }],
  });

  assert.equal(result.response.status, 400);
  assert.match(result.payload.message, /positive whole numbers/i);
  assert.equal(paypalCreateCalls, 0);
  assert.equal(await CheckoutSession.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

for (const invalidProduct of [
  {
    name: "insufficient stock",
    product: { name: "Low-stock item", stock: 1, available: true },
    message: /insufficient stock/i,
  },
  {
    name: "unavailable product",
    product: { name: "Unavailable item", stock: 10, available: false },
    message: /unavailable/i,
  },
]) {
  test(`${invalidProduct.name} is rejected before PayPal payment creation`, async () => {
    const { token } = await harness.createUser();
    const product = await harness.createProduct(invalidProduct.product);
    let paypalCreateCalls = 0;
    harness.setPayPalService({
      createOrder: async () => {
        paypalCreateCalls += 1;
        return { id: "PAYPAL-SHOULD-NOT-BE-CREATED" };
      },
    });

    const result = await post("/api/paypal/create-order", token, checkoutBody(product._id));

    assert.equal(result.response.status, 409);
    assert.match(result.payload.message, invalidProduct.message);
    assert.equal(paypalCreateCalls, 0);
    assert.equal(await CheckoutSession.countDocuments(), 0);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Product.findById(product._id).lean()).stock, invalidProduct.product.stock);
  });
}

test("a different authenticated user cannot confirm another user's checkout", async () => {
  const owner = await harness.createUser({ name: "Checkout owner" });
  const attacker = await harness.createUser({ name: "Different user" });
  const product = await harness.createProduct({ stock: 10 });
  const calls = installApprovedCheckout({ orderId: "OWNER-BOUND-ORDER" });

  const created = await post("/api/paypal/create-order", owner.token, checkoutBody(product._id));
  const result = await post("/api/orders/confirm", attacker.token, {
    paypalOrderId: created.payload.id,
  });

  assert.equal(result.response.status, 404);
  assert.equal(calls.get.length, 0);
  assert.equal(calls.capture.length, 0);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});

test("PayPal ownership metadata must match the authenticated checkout", async () => {
  const owner = await harness.createUser({ name: "Checkout owner" });
  const otherUser = await harness.createUser({ name: "Metadata attacker" });
  const product = await harness.createProduct({ stock: 10 });
  const calls = installApprovedCheckout({
    orderId: "MISMATCHED-OWNER-ORDER",
    getCustomId: () => String(otherUser.user._id),
  });

  const created = await post("/api/paypal/create-order", owner.token, checkoutBody(product._id));
  const result = await post("/api/orders/confirm", owner.token, {
    paypalOrderId: created.payload.id,
  });

  assert.equal(result.response.status, 403);
  assert.match(result.payload.message, /does not belong/i);
  assert.equal(calls.get.length, 1);
  assert.equal(calls.capture.length, 0);
  assert.equal(await Order.countDocuments(), 0);
  assert.equal((await Product.findById(product._id).lean()).stock, 10);
});
