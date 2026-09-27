import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomOrderEmail, notifyCustomOrderAdmin } from "../services/customOrderNotification.js";

const order = {
  _id: "507f1f77bcf86cd799439011",
  customerName: "Kovács Anna <img src=x onerror=alert(1)>",
  customerEmail: "anna@example.com",
  customerPhone: "+36 30 123 4567",
  description: "Első sor\n<script>alert('x')</script>",
  material: "PLA", dimensions: "20 × 40 mm", quantity: 2,
  modelFile: { originalName: "konzol.stl", filename: "private-random-id.stl", size: 128 },
};
const config = { from: "orders@example.com", adminEmail: "admin@example.com", appBaseUrl: "https://techlines.example" };
const env = { SMTP_HOST: "smtp.example.com", SMTP_FROM: config.from, CUSTOM_ORDER_ADMIN_EMAIL: config.adminEmail, APP_BASE_URL: config.appBaseUrl };

test("notification uses literal text only and includes the complete request and admin link", () => {
  const email = buildCustomOrderEmail(order, config);
  assert.equal(email.from, config.from);
  assert.equal(email.to, config.adminEmail);
  assert.equal(email.replyTo, order.customerEmail);
  assert.equal(email.subject, `Új egyedi megrendelés – ${order._id}`);
  assert.equal(Object.hasOwn(email, "html"), false);
  assert.equal(Object.hasOwn(email, "attachments"), false);
  assert.equal(email.disableFileAccess, true);
  assert.equal(email.disableUrlAccess, true);
  for (const value of [order._id, order.customerName, order.customerEmail, order.customerPhone, order.description, order.material, order.dimensions, "Mennyiség: 2", "konzol.stl (128 bájt)", `${config.appBaseUrl}/admin/custom-orders/${order._id}`]) {
    assert.ok(email.text.includes(value), `Missing ${value}`);
  }
  assert.equal(email.text.includes(order.modelFile.filename), false);
});

test("text-only notification reports no model without requiring an app URL", () => {
  const email = buildCustomOrderEmail({ ...order, modelFile: undefined }, { ...config, appBaseUrl: undefined });
  assert.ok(email.text.includes("Modellfájl csatolva a megrendeléshez: Nem"));
  assert.equal(email.text.includes("Adminisztráció:"), false);
});

test("email headers never accept customer names, description, or injected addresses", () => {
  assert.throws(() => buildCustomOrderEmail({ ...order, customerEmail: "anna@example.com\r\nBcc: victim@example.com" }, config));
  assert.throws(() => buildCustomOrderEmail({ ...order, _id: "id\r\nBcc: victim@example.com" }, config));
  for (const adminEmail of ["", "invalid", "one@example.com,two@example.com", "admin@example.com\r\n", "admin@example.com\nBcc: other@example.com"]) {
    assert.throws(() => buildCustomOrderEmail(order, { ...config, adminEmail }));
  }
  assert.throws(() => buildCustomOrderEmail(order, { ...config, from: "Name <orders@example.com>" }));
  assert.throws(() => buildCustomOrderEmail(order, { ...config, appBaseUrl: "javascript:alert(1)" }));
});

test("notification sends through an injected transport with bounded timeouts and closes it", async () => {
  let transportOptions;
  let sentMessage;
  let closed = false;
  const result = await notifyCustomOrderAdmin(order, {
    env: { ...env, SMTP_PORT: "465", SMTP_SECURE: "true", SMTP_USER: "user", SMTP_PASS: "secret" },
    createTransport(options) {
      transportOptions = options;
      return {
        async sendMail(message) { sentMessage = message; return { accepted: [config.adminEmail], rejected: [], messageId: "test-id" }; },
        close() { closed = true; },
      };
    },
  });
  assert.equal(result.messageId, "test-id");
  assert.equal(sentMessage.to, config.adminEmail);
  assert.equal(transportOptions.host, env.SMTP_HOST);
  assert.equal(transportOptions.port, 465);
  assert.equal(transportOptions.secure, true);
  assert.deepEqual(transportOptions.auth, { user: "user", pass: "secret" });
  for (const key of ["connectionTimeout", "greetingTimeout", "socketTimeout", "dnsTimeout"]) {
    assert.ok(transportOptions[key] > 0 && transportOptions[key] <= 10000);
  }
  assert.equal(transportOptions.disableFileAccess, true);
  assert.equal(transportOptions.disableUrlAccess, true);
  assert.equal(closed, true);
});

test("unauthenticated SMTP relay defaults are explicit", async () => {
  await notifyCustomOrderAdmin(order, {
    env,
    createTransport(options) {
      assert.equal(options.port, 587);
      assert.equal(options.secure, false);
      assert.equal(Object.hasOwn(options, "auth"), false);
      return { async sendMail() { return { accepted: [config.adminEmail.toUpperCase()] }; } };
    },
  });
});

test("configuration errors fail before attempting SMTP", async () => {
  for (const overrides of [
    { SMTP_HOST: "" }, { SMTP_PORT: "zero" }, { SMTP_PORT: "0" }, { SMTP_PORT: "65536" },
    { SMTP_SECURE: "yes" }, { SMTP_USER: "user" }, { SMTP_PASS: "secret" },
    { SMTP_FROM: "" }, { CUSTOM_ORDER_ADMIN_EMAIL: "bad" },
  ]) {
    await assert.rejects(() => notifyCustomOrderAdmin(order, {
      env: { ...env, ...overrides },
      createTransport() { assert.fail("Transport must not be created with invalid configuration"); },
    }));
  }
});

test("SMTP errors or rejected delivery are propagated and always close the transport", async () => {
  const originalOrder = structuredClone(order);
  for (const sendResult of [new Error("Connection failed"), { accepted: [], rejected: [config.adminEmail] }, { accepted: ["other@example.com"] }]) {
    let closed = false;
    await assert.rejects(() => notifyCustomOrderAdmin(order, {
      env,
      createTransport() {
        return {
          async sendMail() {
            if (sendResult instanceof Error) throw sendResult;
            return sendResult;
          },
          close() { closed = true; },
        };
      },
    }));
    assert.equal(closed, true);
    assert.deepEqual(order, originalOrder);
  }
});
