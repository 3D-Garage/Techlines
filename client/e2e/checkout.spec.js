import { test, expect } from "@playwright/test";
const checkoutId = "507f1f77bcf86cd799439012";
const userId = "507f1f77bcf86cd799439013";
const key = `activeCheckout:${userId}`;
const address = { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" };
const productId = "507f1f77bcf86cd799439011";
const quote = { items: [{ productId, name: "Test product", image: "/favicon.png", qty: 1, unitPrice: 1000, lineTotal: 1000 }], subtotal: 1000, shippingMethod: "standard", shippingPrice: 1490, total: 2490, currency: "HUF" };
// A deterministic SDK adapter exercises the real PayPal React callbacks.
// This suite tests browser recovery; live Sandbox acceptance is a separate check.
const sdk = `window.paypal = { Buttons: function(options) {
  let button;
  return { isEligible: () => true,
    render: async (container) => {
      button = document.createElement('button'); button.textContent = 'Test PayPal approval';
      button.onclick = async () => { try { const id = await options.createOrder(); if (window.cancelNextTestPayment) { window.cancelNextTestPayment=false; return; } await options.onApprove({orderID:id}); } catch (error) { options.onError(error); } };
      container.appendChild(button);
      options.onInit({}, { enable: async () => {button.disabled=false;}, disable: async () => {button.disabled=true;} });
    }, close: async () => { if(button) button.remove(); }
  };
} };`;

async function setup(page, { active = null, completed = false } = {}) {
  const state = { completed, creates: [], confirms: [], lookups: 0, status: active?.status || "PROCESSING", rejection: null };
  await page.addInitScript(({ userId, key, active }) => {
    if (sessionStorage.getItem("checkout-test-initialized")) return;
    sessionStorage.setItem("checkout-test-initialized", "true");
    localStorage.setItem("userInfo", JSON.stringify({ _id: userId, name: "Test Customer", token: "test-token" }));
    localStorage.setItem("cartItems", JSON.stringify([{ id: "507f1f77bcf86cd799439011", name: "Test product", price: 1000, qty: 1, image: "/favicon.png", stock: 3 }]));
    if (active) localStorage.setItem(key, JSON.stringify(active));
  }, { userId, key, active });
  await page.route("https://www.paypal.com/sdk/js**", (route) => route.fulfill({ contentType: "application/javascript", body: sdk }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let data;
    if (path === "/api/checkout/quote") data = quote;
    else if (path === "/api/paypal/client-id") data = { clientId: "test-client" };
    else if (path === "/api/paypal/create-order") {
      state.creates.push(route.request().postDataJSON());
      if (state.rejection) { status = state.rejection; data = { message: "Product is unavailable.", creationRejected: true }; }
      else { state.status = "READY"; data = { checkoutId, id: "PAYPAL-ORDER", status: "READY", shippingAddress: address, quote, total: quote.total }; }
    } else if (path === "/api/orders/confirm") {
      state.confirms.push(route.request().postDataJSON());
      status = 202;
      state.status = "PROCESSING";
      data = { checkoutId, status: "PROCESSING" };
    } else if (path === `/api/checkout/${checkoutId}`) {
      state.lookups++;
      data = { checkoutId, id: "PAYPAL-ORDER", status: state.completed ? "COMPLETED" : state.status, shippingAddress: address, quote, total: 2490,
        ...(state.completed ? { order: { _id: "order", paymentStatus: "COMPLETED", paypalCaptureId: "capture", orderItems: [{ product_id: productId, qty: 1 }] } } : {}) };
    } else data = [];
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
  });
  await page.goto("/checkout");
  return state;
}
test("uses the webshop address, keeps cart on 202, and resumes polling after reload", async ({ page }) => {
  const state = await setup(page);
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  await page.getByText("Express 3,990 Ft", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Express 3,990/ })).toBeChecked();
  await page.getByText("Standard 1,490 Ft", { exact: true }).click();
  await expect(page.getByRole("radio", { name: /Standard 1,490/ })).toBeChecked();
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.getByText(/A fizetés ellenőrzése folyamatban/)).toBeVisible();
  expect(state.creates[0].shippingAddress).toEqual(address);
  expect(state.creates[0].shippingMethod).toBe("standard");
  expect(state.confirms).toEqual([{ checkoutId }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cartItems")).length)).toBe(1);
  await page.reload();
  await expect(page.getByText(/A fizetés ellenőrzése folyamatban/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Test PayPal approval", includeHidden: true })).toBeHidden();
  await expect(page.getByText(`Szállítás: ${address.address}, ${address.postalCode} ${address.city}, HU`)).toBeVisible();
  expect(state.lookups).toBeGreaterThan(0);
  expect(state.creates.length).toBe(1);
  state.completed = true;
  await expect(page.getByText("Payment successful!")).toBeVisible({ timeout: 10000 });
  expect(await page.evaluate(({ key }) => ({ cart: localStorage.getItem("cartItems"), checkout: localStorage.getItem(key) }), { key })).toEqual({ cart: null, checkout: null });
});
test("a persisted payment blocks new starts while provider verification is pending", async ({ page }) => {
  const state = await setup(page, { active: { checkoutId, status: "PROCESSING" } });
  await expect(page.getByText(/A fizetés ellenőrzése folyamatban/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/A fizetés ellenőrzése folyamatban/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Test PayPal approval", includeHidden: true })).toBeHidden();
  expect(state.creates).toHaveLength(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cartItems")).length)).toBe(1);
});

test("rejected creation unlocks checkout and permits a corrected payment", async ({ page }) => {
  const state = await setup(page);
  state.rejection = 409;
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.locator('input[name="address"]')).toBeEnabled();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  state.rejection = null;
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates).toHaveLength(2);
  expect(state.creates[1].requestId).not.toBe(state.creates[0].requestId);
});

test("cancelled READY payment keeps its saved details after cart changes and only removes purchased quantities", async ({ page }) => {
  const state = await setup(page);
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  await page.evaluate(() => { window.cancelNextTestPayment = true; });
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.locator('input[name="address"]')).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Express 3,990/ })).toBeDisabled();
  await expect(page.getByText("Quantity: 1", { exact: true })).toBeVisible();
  expect(state.confirms).toHaveLength(0);
  // Simulate continuing to shop, adding more of the same product and another item.
  await page.evaluate(({ productId }) => localStorage.setItem("cartItems", JSON.stringify([
    { id: productId, name: "Test product", qty: 3, price: 1000, image: "/favicon.png", stock: 3 },
    { id: "other-product", name: "Other cart product", qty: 1, price: 2000, image: "/favicon.png", stock: 3 },
  ])), { productId });
  await page.reload();
  await expect(page.locator('input[name="address"]')).toHaveValue(address.address);
  await expect(page.locator('input[name="address"]')).toBeDisabled();
  await expect(page.getByText("Quantity: 1", { exact: true })).toBeVisible();
  await expect(page.getByText("Other cart product", { exact: true })).toHaveCount(0);
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates).toHaveLength(1);
  state.completed = true;
  await expect(page.getByText("Payment successful!")).toBeVisible({ timeout: 10000 });
  const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem("cartItems")));
  expect(remaining.map(({ id, qty }) => ({ id, qty }))).toEqual([{ id: productId, qty: 2 }, { id: "other-product", qty: 1 }]);
});
