// Explicit live acceptance check; the automated suites mock all FOXPOST dependencies.
import assert from "node:assert/strict";
import express from "express";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { getFoxpostLockers } from "../services/foxpostService.js";

const lockers = await getFoxpostLockers();
assert.ok(lockers.length > 0, "The live FOXPOST directory must contain eligible lockers");
const artifacts = resolve(".test-artifacts/foxpost-widget");
await mkdir(artifacts, { recursive: true });
const app = express();
app.use(express.static(resolve("client/build")));
app.get("*", (_req, res) => res.sendFile(resolve("client/build/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise((done, reject) => { server.once("listening", done); server.once("error", reject); });
let browser, currentPage;
const searchRequests = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    currentPage = page;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === "https://cdn.foxpost.hu" && url.pathname.endsWith("/markers.php")) {
        searchRequests.push({ viewport: viewport.width, keyword: url.searchParams.get("keyword") });
      }
    });
    await page.addInitScript(() => {
      localStorage.setItem("userInfo", JSON.stringify({ _id: "foxpost-live-test", name: "Widget Test", email: "widget-test@example.com", token: "test" }));
      localStorage.setItem("cartItems", JSON.stringify([{ id: "507f1f77bcf86cd799439011", name: "Test product", price: 1000, qty: 1, image: "/favicon.png", stock: 1 }]));
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data = path === "/api/shipping/foxpost/lockers" ? { lockers } : path === "/api/checkout/quote" ? { items: [], subtotal: 1000, shippingMethod: route.request().postDataJSON().shippingMethod, shippingPrice: 1490, total: 2490, currency: "HUF" } : { message: "Live payment disabled for widget test" };
      await route.fulfill({ status: path === "/api/paypal/client-id" ? 503 : 200, contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/checkout`);
    await page.getByText("FOXPOST csomagautomata", { exact: true }).click();
    await page.getByRole("button", { name: "Automata választása", exact: true }).click();
    const picker = page.frameLocator('iframe[title="FOXPOST térképes és listás automataválasztó"]');
    await picker.getByPlaceholder("Átvevőhely keresése").filter({ visible: true }).first().waitFor({ state: "visible", timeout: 30000 });
    await picker.locator("a.button__select-apt").first().waitFor({ state: "attached", timeout: 30000 });
    // Search by city, then explicitly submit the search. The widget's initial map
    // animation can replace keyup-only results, and an exact name search can
    // select a point automatically before we click its details.
    const search = picker.getByPlaceholder("Átvevőhely keresése").filter({ visible: true }).first();
    await search.fill("");
    const target = lockers[0];
    // The provider updates its search keyword on a 400 ms throttled keyup.
    // Type slower than that throttle so Enter submits the complete city.
    await search.pressSequentially(target.city, { delay: 450 });
    const [response] = await Promise.all([
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.origin === "https://cdn.foxpost.hu" && url.pathname.endsWith("/markers.php") && url.searchParams.get("keyword") === target.city;
      }, { timeout: 30000 }),
      search.press("Enter"),
    ]);
    assert.ok(response.ok(), `Live FOXPOST search failed: HTTP ${response.status()}`);
    const results = await response.json();
    assert.ok(results.list?.some((point) => String(point.place_id) === target.place_id), "The searched city must include the expected eligible locker");
    const row = picker.locator(`li.apt-list__item[data-place-id="${target.place_id}"]`).filter({ visible: true }).first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator(".apt-list__item-name")).toHaveText(target.name);
    const modal = await page.getByRole("dialog").boundingBox();
    assert.ok(modal && modal.x >= 0 && modal.x + modal.width <= viewport.width + 1, "Modal must fit viewport");
    await page.screenshot({ path: resolve(artifacts, `widget-${viewport.width}.png`), fullPage: true });
    // Mobile exposes an icon button directly on the row; desktop exposes the
    // button inside the expanded details. Always select this exact locker.
    const select = row.locator(`a.button__select-apt[data-place-id="${target.place_id}"]`).filter({ visible: true }).first();
    if (!await select.isVisible()) await row.locator("a.js-collapse").click();
    await expect(select).toBeVisible();
    await select.click();
    await page.getByText(target.name, { exact: true }).waitFor({ state: "visible", timeout: 10000 });
    await page.getByText(target.address, { exact: true }).waitFor({ state: "visible" });
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("shippingDraft:foxpost-live-test"))?.foxpostLocker?.place_id)).toBe(target.place_id);
    console.log(`Live FOXPOST widget ${viewport.width}x${viewport.height}: list, search, selection of ${target.place_id} and modal verified`);
    await context.close();
  }
} catch (error) {
  console.error("Live FOXPOST search requests:", JSON.stringify(searchRequests));
  if (currentPage && !currentPage.isClosed()) {
    await currentPage.screenshot({ path: resolve(artifacts, "failure.png"), fullPage: true });
    for (const frame of currentPage.frames()) console.error(`Frame ${frame.url()}: ${(await frame.locator("body").innerText().catch(() => "Unavailable")).slice(0,2000)}`);
  }
  throw error;
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
}
