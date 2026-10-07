import { test, expect } from "@playwright/test";
const checkoutId = "507f1f77bcf86cd799439012";
const userId = "507f1f77bcf86cd799439013";
const key = `activeCheckout:${userId}`;
const address = { address: "Webshop utca 1", city: "Budapest", postalCode: "1111", country: "HU" };
const productId = "507f1f77bcf86cd799439011";
const productB = { _id: "507f1f77bcf86cd799439015", name: "Product B", image: "/favicon.png", stock: 3, price: 2000, brand: "Test", category: "Test", description: "Replacement product", reviews: [], rating: 0, numReviews: 0 };
const quote = { items: [{ productId, name: "Test product", image: "/favicon.png", qty: 1, unitPrice: 1000, lineTotal: 1000 }], subtotal: 1000, shippingMethod: "standard", shippingPrice: 1490, total: 2490, currency: "HUF" };
const locker = { place_id: "12345", operator_id: "hu123", name: "FOXPOST A-BOX Test", type: "A-BOX", address: "1111 Budapest, Automata utca 2.", street: "Automata utca 2.", postalCode: "1111", city: "Budapest", country: "HU" };
const secondLocker = { ...locker, place_id: "12346", operator_id: "hu124", name: "FOXPOST Z-BOX Second", type: "Z-BOX" };
const widget = `<button onclick='parent.postMessage(JSON.stringify({place_id:12345,name:"Manipulated",address:"Fake"}),"*")'>Select A-BOX</button><button onclick='parent.postMessage(JSON.stringify({place_id:12346}),"*")'>Select Z-BOX</button><button onclick='parent.postMessage(JSON.stringify({place_id:999}),"*")'>Select partner</button>`;
const quoteFor = (body) => {
  const items = body.items.map((item) => ({ ...item, name: item.productId === productB._id ? productB.name : "Test product", image: "/favicon.png", unitPrice: item.productId === productB._id ? productB.price : 1000,
    lineTotal: item.qty * (item.productId === productB._id ? productB.price : 1000) }));
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const shippingPrice = body.shippingMethod === "express" ? 3990 : subtotal >= 10000 ? 0 : 1490;
  return { items, subtotal, shippingMethod: body.shippingMethod, shippingPrice, total: subtotal + shippingPrice, currency: "HUF" };
};
// A deterministic SDK adapter exercises the real PayPal React callbacks.
// This suite tests browser recovery; live Sandbox acceptance is a separate check.
const sdk = `window.paypal = { Buttons: function(options) {
  let button;
  return { isEligible: () => true,
    render: async (container) => {
      button = document.createElement('button'); button.textContent = 'Test PayPal approval';
      button.onclick = async () => { try { const id = await options.createOrder(); if (window.leaveNextTestPaymentUnresolved) { window.leaveNextTestPaymentUnresolved=false; return; } if (window.cancelNextTestPayment) { window.cancelNextTestPayment=false; await options.onCancel({orderID:id}); return; } await options.onApprove({orderID:id}); } catch (error) { options.onError(error); } };
      container.appendChild(button);
      options.onInit({}, { enable: async () => {button.disabled=false;}, disable: async () => {button.disabled=true;} });
    }, close: async () => { if(button) button.remove(); }
  };
} };`;

async function setup(page, { active = null, completed = false } = {}) {
  const state = { completed, creates: [], confirms: [], cancels: [], lookups: 0, status: active?.status || "PROCESSING", rejection: null, listFailure: false, quoteFailure: false, saved: active, liveQuote: null, listCalls: 0, savedRequestId: null, loseCreationResponse: false, cancelFailure: false, createdCheckouts: 0 };
  await page.addInitScript(({ userId, key, active }) => {
    if (sessionStorage.getItem("checkout-test-initialized")) return;
    sessionStorage.setItem("checkout-test-initialized", "true");
    localStorage.setItem("userInfo", JSON.stringify({ _id: userId, name: "Test Customer", email: "customer@example.com", token: "test-token" }));
    localStorage.setItem("cartItems", JSON.stringify([{ id: "507f1f77bcf86cd799439011", name: "Test product", price: 1000, qty: 1, image: "/favicon.png", stock: 3 }]));
    if (active) localStorage.setItem(key, JSON.stringify(active));
  }, { userId, key, active });
  await page.route("https://www.paypal.com/sdk/js**", (route) => route.fulfill({ contentType: "application/javascript", body: sdk }));
  await page.route("https://cdn.foxpost.hu/apt-finder/v1/app/**", (route) => route.fulfill({ contentType: "text/html", body: widget }));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let status = 200;
    let data;
    if (path === "/api/checkout/quote") {
      if (state.quoteFailure) { status = 503; data = { message: "Quote unavailable" }; }
      else data = state.liveQuote || quoteFor(route.request().postDataJSON());
    }
    else if (path === "/api/shipping/foxpost/lockers") {
      state.listCalls++;
      if (state.listFailure) { status = 503; data = { message: "List unavailable" }; }
      else data = { lockers: [locker, secondLocker] };
    }
    else if (path === "/api/paypal/client-id") data = { clientId: "test-client" };
    else if (path === "/api/paypal/create-order") {
      state.creates.push(route.request().postDataJSON());
      if (state.saved && state.savedRequestId === route.request().postDataJSON().requestId) data = state.saved;
      else if (state.rejection) { status = state.rejection; data = { message: "Product is unavailable.", creationRejected: true }; }
      else if (state.liveQuote && route.request().postDataJSON().expectedTotal !== state.liveQuote.total) {
        status = 409; data = { message: "Az ajánlat összege megváltozott.", code: "QUOTE_CHANGED", creationRejected: true, quote: state.liveQuote };
      }
      else {
        state.status = "READY";
        const body = route.request().postDataJSON();
        const selected = body.foxpostLockerId === secondLocker.place_id ? secondLocker : locker;
        const savedQuote = state.liveQuote || quoteFor(body);
        const newCheckoutId = state.createdCheckouts++ === 0 ? checkoutId : "507f1f77bcf86cd799439016";
        data = { checkoutId: newCheckoutId, id: state.createdCheckouts === 1 ? "PAYPAL-ORDER" : "PAYPAL-ORDER-B", status: "READY", shippingAddress: body.shippingMethod === "foxpost" ? { address: selected.street, city: selected.city, postalCode: selected.postalCode, country: "HU" } : address, quote: savedQuote, total: savedQuote.total,
          ...(body.shippingMethod === "foxpost" ? { shippingMethod: "foxpost", foxpostLockerId: selected.place_id, foxpostLocker: selected, recipientPhone: "+36301234567" } : {}) };
        state.saved = data;
        state.savedRequestId = body.requestId;
        if (state.loseCreationResponse) {
          state.loseCreationResponse = false;
          await route.abort("failed");
          return;
        }
      }
    } else if (path === `/api/checkout/${state.saved?.checkoutId || checkoutId}/cancel`) {
      state.cancels.push(path);
      if (state.cancelFailure) { status = 503; data = { message: "Cancellation could not be verified" }; }
      else { state.status = "FAILED"; state.saved = { ...state.saved, status: "FAILED", issue: "CHECKOUT_CANCELLED" }; data = state.saved; }
    } else if (path === `/api/products/${productB._id}`) data = productB;
    else if (path === "/api/orders/confirm") {
      state.confirms.push(route.request().postDataJSON());
      status = 202;
      state.status = "PROCESSING";
      data = { checkoutId: state.saved?.checkoutId || checkoutId, status: "PROCESSING" };
    } else if (path === `/api/checkout/${state.saved?.checkoutId || checkoutId}`) {
      state.lookups++;
      data = { checkoutId, id: "PAYPAL-ORDER", shippingAddress: address, quote, total: 2490, ...state.saved, status: state.completed ? "COMPLETED" : state.status,
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

test("FOXPOST switches modes, rejects partner and forged messages, swaps lockers and restores the draft", async ({ page }) => {
  await setup(page);
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await expect(page.locator('input[name="address"]')).toHaveCount(0);
  await expect(page.getByText("Címzett: Test Customer")).toBeVisible();
  await expect(page.getByText("E-mail: customer@example.com")).toBeVisible();
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeDisabled();
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  const frame = page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]');
  await frame.getByRole("button", { name: "Select partner" }).press("Enter");
  await expect(page.getByRole("alert")).toContainText("Más partnerpont");
  await page.evaluate(() => {
    const source = document.querySelector('iframe[title="FOXPOST térképes és listás automataválasztó"]').contentWindow;
    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.example", source, data: JSON.stringify({ place_id: 12345 }) }));
    window.dispatchEvent(new MessageEvent("message", { origin: "https://cdn.foxpost.hu", source: window, data: JSON.stringify({ place_id: 12345 }) }));
  });
  await expect(page.getByRole("dialog")).toBeVisible();
  await frame.getByRole("button", { name: "Select A-BOX" }).press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(locker.name, { exact: true })).toBeVisible();
  await expect(page.getByText("Manipulated", { exact: true })).toHaveCount(0);
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("+3611234567");
  await expect(pay).toBeDisabled();
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 30 123 4567");
  await expect(pay).toBeEnabled();
  await page.getByRole("button", { name: "Másik automata választása" }).click();
  await frame.getByRole("button", { name: "Select Z-BOX" }).press("Enter");
  await expect(page.getByText(secondLocker.name, { exact: true })).toBeVisible();
  await page.getByText("Standard 1,490 Ft", { exact: true }).click();
  await expect(page.locator('input[name="address"]')).toHaveValue(address.address);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: /FOXPOST csomagautomata/ })).toBeChecked();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toHaveValue("06 30 123 4567");
  await expect(page.getByText(secondLocker.name, { exact: true })).toBeVisible();
  await expect(pay).toBeEnabled();
});

test("FOXPOST READY payment persists and locks locker and phone across reload and directory failure", async ({ page }) => {
  const state = await setup(page);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 30 123 4567");
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
  await page.evaluate(() => { window.leaveNextTestPaymentUnresolved = true; });
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Másik automata választása" })).toHaveCount(0);
  expect(state.creates[0].shippingAddress).toBeUndefined();
  expect(state.creates[0].foxpostLockerId).toBe(locker.place_id);
  expect(state.creates[0].recipientPhone).toBe("06 30 123 4567");
  state.listFailure = true;
  await page.reload();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toHaveValue("+36301234567");
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Standard 1,490/ })).toBeDisabled();
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  await expect(pay).toBeHidden();
});

test("FOXPOST list and quote failures offer retry and leave home delivery usable", async ({ page }) => {
  const state = await setup(page);
  state.listFailure = true;
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Automatalista újratöltése" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Test PayPal approval" })).toBeDisabled();
  state.listFailure = false;
  await page.getByRole("button", { name: "Automatalista újratöltése" }).click();
  await expect(page.getByRole("button", { name: "Automata választása", exact: true })).toBeEnabled();
  state.quoteFailure = true;
  await page.getByText("Standard 1,490 Ft", { exact: true }).click();
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  await expect(page.getByRole("button", { name: "Árajánlat újratöltése" })).toBeVisible();
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeDisabled();
  state.quoteFailure = false;
  await page.getByRole("button", { name: "Árajánlat újratöltése" }).click();
  await expect(pay).toBeEnabled();
});

test("mobile FOXPOST modal fits the screen and reloads the widget before selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  const initialFrame = await page.locator('iframe[title="FOXPOST térképes és listás automataválasztó"]').elementHandle();
  await page.getByRole("button", { name: "Választó újratöltése" }).click();
  expect(await initialFrame.evaluate((element) => element.isConnected)).toBe(false);
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(locker.name, { exact: true })).toBeVisible();
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

test("READY payment without a cancellation callback keeps its saved details and only removes purchased quantities", async ({ page }) => {
  const state = await setup(page);
  await page.locator('input[name="address"]').fill(address.address);
  await page.locator('input[name="postalCode"]').fill(address.postalCode);
  await page.locator('input[name="city"]').fill(address.city);
  await page.evaluate(() => { window.leaveNextTestPaymentUnresolved = true; });
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

for (const shippingMethod of ["standard", "express", "foxpost"]) {
  for (const total of [shippingMethod === "express" ? 4490 : 1990, 6490]) test(`${shippingMethod}: changed total ${total} requires explicit acceptance and a new request`, async ({ page }) => {
    const state = await setup(page);
    if (shippingMethod === "foxpost") {
      await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
      await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 51 123 4567");
      await page.getByRole("button", { name: "Automata választása", exact: true }).click();
      await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
    } else {
      await page.locator('input[name="address"]').fill(address.address);
      await page.locator('input[name="postalCode"]').fill(address.postalCode);
      await page.locator('input[name="city"]').fill(address.city);
      if (shippingMethod === "express") await page.getByText("Express 3,990 Ft", { exact: true }).click();
    }
    const pay = page.getByRole("button", { name: "Test PayPal approval" });
    await expect(pay).toBeEnabled();
    const oldTotal = shippingMethod === "express" ? 4990 : 2490;
    const shippingPrice = shippingMethod === "express" ? 3990 : 1490;
    const subtotal = total - shippingPrice;
    state.liveQuote = { ...quote, items: quote.items.map((item) => ({ ...item, unitPrice: subtotal, lineTotal: subtotal })), shippingMethod, shippingPrice, total, subtotal };
    await pay.click();
    const accept = page.getByRole("button", { name: "Új összeg elfogadása" });
    await expect(accept).toBeVisible();
    await expect(page.getByText(`Korábbi végösszeg: ${oldTotal.toLocaleString("hu-HU")} Ft`)).toBeVisible();
    await expect(page.getByText(`Új végösszeg: ${total.toLocaleString("hu-HU")} Ft`)).toBeVisible();
    await expect(pay).toBeDisabled();
    expect(state.confirms).toHaveLength(0);
    expect(state.creates[0].expectedTotal).toBe(oldTotal);
    await page.reload();
    await expect(accept).toBeVisible();
    await expect(pay).toBeDisabled();
    expect(state.creates).toHaveLength(1);
    await accept.click();
    await expect(pay).toBeEnabled();
    state.liveQuote = { ...state.liveQuote, items: quote.items.map((item) => ({ ...item, unitPrice: subtotal + 100, lineTotal: subtotal + 100 })), total: total + 100, subtotal: subtotal + 100 };
    await pay.click();
    await expect(accept).toBeVisible();
    await expect(pay).toBeDisabled();
    expect(state.creates[1].expectedTotal).toBe(total);
    expect(state.creates[1].requestId).not.toBe(state.creates[0].requestId);
    await accept.click();
    await expect(pay).toBeEnabled();
    await pay.click();
    await expect.poll(() => state.confirms.length).toBe(1);
    expect(state.creates[2].expectedTotal).toBe(total + 100);
    expect(state.creates[2].requestId).not.toBe(state.creates[1].requestId);
  });
}

for (const status of ["CREATING", "READY", "PROCESSING", "REVIEW"]) test(`FOXPOST ${status} locks saved items, method and recipient details`, async ({ page }) => {
  const active = { checkoutId, id: "PAYPAL-ORDER", status, quote: { ...quote, shippingMethod: "foxpost" }, foxpostLocker: locker,
    shippingMethod: "foxpost", recipientPhone: "+36511234567", shippingAddress: { address: locker.street, city: locker.city, postalCode: locker.postalCode, country: "HU" } };
  const state = await setup(page, { active });
  await expect(page.getByText("Quantity: 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toHaveValue("+36511234567");
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  await expect(page.getByRole("radio", { name: /Standard 1,490/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Másik automata választása" })).toHaveCount(0);
  if (status === "READY") await expect(page.getByRole("button", { name: "Test PayPal approval" })).toBeEnabled();
  else await expect(page.getByRole("button", { name: "Test PayPal approval", includeHidden: true })).toBeHidden();
  expect(state.creates).toHaveLength(0);
  expect(state.listCalls).toBe(0);
});

for (const status of ["FAILED", "EXPIRED"]) test(`FOXPOST ${status} resets explicitly, reloads the directory and starts a new request`, async ({ page }) => {
  const state = await setup(page, { active: { checkoutId, requestId: "old-request", status, quote: { ...quote, shippingMethod: "foxpost" } } });
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 30 123 4567");
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
  const previousListCalls = state.listCalls;
  await page.getByRole("button", { name: "Új fizetés előkészítése" }).click();
  await expect.poll(() => state.listCalls).toBeGreaterThan(previousListCalls);
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates[0].requestId).not.toBe("old-request");
  expect(state.creates[0].expectedTotal).toBe(2490);
});

test("a loaded widget with broken content keeps reload and mode switching usable", async ({ page }) => {
  await setup(page);
  await page.route("https://cdn.foxpost.hu/apt-finder/v1/app/**", (route) => route.fulfill({ contentType: "text/html", body: "<p>Internal map and list failure</p>" }));
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  await expect(page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByText("Internal map and list failure")).toBeVisible();
  await expect(page.getByText(/Ha a térkép vagy a lista nem működik/)).toBeVisible();
  await page.getByRole("button", { name: "Választó újratöltése" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await page.getByText("Standard 1,490 Ft", { exact: true }).click();
  await expect(page.locator('input[name="address"]')).toBeEnabled();
});

test("lost FOXPOST creation response freezes the local snapshot and replays the same request after reload and outages", async ({ page }) => {
  const state = await setup(page);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 30 123 4567");
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  state.loseCreationResponse = true;
  await pay.click();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  await expect(page.getByText("Quantity: 1", { exact: true })).toBeVisible();
  await expect(page.getByText(locker.name, { exact: true })).toBeVisible();
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
  expect(saved.status).toBe("CREATING");
  expect(saved.checkoutId).toBeUndefined();
  expect(saved.foxpostLocker).toEqual(locker);
  expect(saved.recipientPhone).toBe("06 30 123 4567");
  const listCalls = state.listCalls;
  state.listFailure = true;
  state.liveQuote = { ...quote, shippingMethod: "foxpost", total: 3490 };
  await page.reload();
  await expect(page.getByText(/Folytasd a már előkészített PayPal/)).toBeVisible();
  await expect(pay).toBeEnabled();
  expect(state.creates).toHaveLength(2);
  expect(state.creates[1]).toEqual(state.creates[0]);
  expect(state.listCalls).toBe(listCalls);
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates).toHaveLength(2);
});

test("PayPal cancellation unlocks FOXPOST, allows another locker and replaces product A with product B", async ({ page }) => {
  const state = await setup(page);
  await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
  await page.getByLabel(/Magyar mobiltelefonszám/).fill("06 30 123 4567");
  await page.getByRole("button", { name: "Automata választása", exact: true }).click();
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select A-BOX" }).press("Enter");
  const pay = page.getByRole("button", { name: "Test PayPal approval" });
  await expect(pay).toBeEnabled();
  await page.evaluate(() => { window.cancelNextTestPayment = true; });
  await pay.click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  expect(state.cancels).toHaveLength(1);
  expect(state.confirms).toHaveLength(0);
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeEnabled();
  await page.getByRole("button", { name: "Másik automata választása" }).click();
  await page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]').getByRole("button", { name: "Select Z-BOX" }).press("Enter");
  await expect(page.getByText(secondLocker.name, { exact: true })).toBeVisible();
  // Follow the reported journey using the actual cart and product controls.
  await page.goto("/cart");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cartItems")).length)).toBe(0);
  await page.goto(`/product/${productB._id}`);
  await page.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("cartItems"))[0]?.id)).toBe(productB._id);
  await page.goto("/cart");
  await page.getByText("Checkout", { exact: true }).click();
  await expect(page.getByText(productB.name, { exact: true })).toBeVisible();
  await expect(page.getByText("Test product", { exact: true })).toHaveCount(0);
  await expect(page.getByText(secondLocker.name, { exact: true })).toBeVisible();
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect.poll(() => state.confirms.length).toBe(1);
  expect(state.creates[1].items).toEqual([{ productId: productB._id, qty: 1 }]);
  expect(state.creates[1].foxpostLockerId).toBe(secondLocker.place_id);
  expect(state.creates[1].requestId).not.toBe(state.creates[0].requestId);
  expect(state.confirms[0].checkoutId).not.toBe(checkoutId);
});

test("a previously stuck READY checkout can be abandoned with the modify order button after reload", async ({ page }) => {
  const active = { checkoutId, id: "PAYPAL-ORDER", status: "READY", quote: { ...quote, shippingMethod: "foxpost" }, foxpostLocker: locker,
    shippingMethod: "foxpost", recipientPhone: "+36301234567", shippingAddress: { address: locker.street, city: locker.city, postalCode: locker.postalCode, country: "HU" } };
  const state = await setup(page, { active });
  await page.reload();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  state.cancelFailure = true;
  await page.getByRole("button", { name: "Rendelés módosítása" }).click();
  await expect(page.getByText("Cancellation could not be verified", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/Magyar mobiltelefonszám/)).toBeDisabled();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).checkoutId, key)).toBe(checkoutId);
  state.cancelFailure = false;
  await page.getByRole("button", { name: "Rendelés módosítása" }).click();
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  await expect(page.getByRole("radio", { name: /Standard 1,490/ })).toBeEnabled();
  await page.reload();
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBeNull();
  expect(state.creates).toHaveLength(0);
});
