import { expect, test } from "@playwright/test";

const userId = "507f1f77bcf86cd799439013";

test("Your Orders fits all order columns within a portrait print page", async ({ page }) => {
  // A4 portrait with 12 mm margins leaves about 703 CSS pixels for content.
  await page.setViewportSize({ width: 703, height: 1032 });
  await page.addInitScript((id) => {
    localStorage.setItem("userInfo", JSON.stringify({ _id: id, name: "Test Customer", token: "test-token" }));
    window.print = () => { document.documentElement.dataset.printRequested = "true"; };
  }, userId);
  await page.route(`**/api/users/${userId}`, (route) => route.fulfill({ json: [{
    _id: "67a7a2b0c6134dfe982873ab",
    createdAt: "2026-10-05T12:00:00Z",
    orderItems: [{ _id: "item-1", qty: 2, name: "Precision mounting bracket with extra-long reinforcement" }],
    totalPrice: 12590,
    shippingMethod: "foxpost",
    foxpostLocker: { name: "FOXPOST A-BOX Kecskemét", address: "6000 Kecskemét, Nagykőrösi utca 18." },
    isDelivered: false,
  }] }));
  await page.goto("/your-orders");

  const printButton = page.getByRole("button", { name: "Print", exact: true });
  await printButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-print-requested", "true");

  await page.emulateMedia({ media: "print" });
  const table = page.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(6);
  await expect(table.getByText("6000 Kecskemét, Nagykőrösi utca 18.")).toBeVisible();
  await expect(table.getByText("Processing")).toBeVisible();
  await expect(printButton).toBeHidden();

  const { right } = await table.evaluate((element) => element.getBoundingClientRect().toJSON());
  expect(right).toBeLessThanOrEqual(703);
  const overflowingCells = await table.locator("tbody td:visible").evaluateAll((cells) =>
    cells.filter((cell) => cell.scrollWidth > cell.clientWidth + 1).map((cell) => cell.textContent)
  );
  expect(overflowingCells).toEqual([]);
});
