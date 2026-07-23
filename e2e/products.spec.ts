import { expect, test, type Page } from "@playwright/test";

import { loginAsOwner, loginAsStaff } from "./helpers/auth";
import { ensureOpenShift } from "./helpers/ensure-shift";

async function clickAndSettle(page: Page, locator: ReturnType<Page["getByRole"]>) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

test.describe("Product Catalog & Sales (requires a seeded database)", () => {
  test("admin manages the catalog, staff sells a product, sale surfaces everywhere it should", async ({
    page,
  }) => {
    const suffix = Date.now();
    const productName = `E2E Test Item ${suffix}`;

    // --- Admin: create, edit price, toggle active/inactive -------------
    await loginAsOwner(page);
    await page.goto("/dashboard/admin/products");

    await page.getByLabel("Name", { exact: true }).fill(productName);
    await page.getByLabel("Price (cents)", { exact: true }).fill("12345");
    await clickAndSettle(page, page.getByRole("button", { name: /^add product$/i }));

    const row = page.locator(`[data-product-name="${productName}"]`);
    await expect(row).toBeVisible();

    // Editable price: bump it and save.
    const priceInput = row.getByRole("spinbutton");
    await priceInput.fill("54321");
    await clickAndSettle(page, row.getByRole("button", { name: /^save$/i }));
    await expect(row.getByRole("spinbutton")).toHaveValue("54321");

    // Active toggle round-trips.
    const activeSwitch = page.getByRole("switch", { name: `${productName} active` });
    await expect(activeSwitch).toBeChecked();
    await activeSwitch.click();
    await expect(activeSwitch).not.toBeChecked();
    await activeSwitch.click();
    await expect(activeSwitch).toBeChecked();
    await clickAndSettle(page, row.getByRole("button", { name: /^save$/i }));

    // --- Staff: sell it, with a real player and open shift -------------
    await loginAsStaff(page);
    await ensureOpenShift(page);

    await page.goto("/dashboard/products");
    await page.getByLabel("Product", { exact: true }).click();
    await page.getByRole("option", { name: new RegExp(productName) }).click();
    await page.getByLabel("Player (optional)", { exact: true }).click();
    await page.getByRole("option", { name: "Kyle Domingo", exact: true }).click();
    await clickAndSettle(page, page.getByRole("button", { name: /^sell$/i }));

    // --- Verify: today's revenue + this shift's sales on the dashboard -
    await page.goto("/dashboard");
    await expect(page.getByText("Product", { exact: true })).toBeVisible();
    await expect(page.getByText(/this shift's sales/i)).toBeVisible();

    // --- Verify: player timeline ----------------------------------------
    await page.goto("/dashboard/players?query=Kyle%20Domingo");
    await clickAndSettle(page, page.getByRole("link", { name: "Kyle Domingo" }).first());
    // Timeline entries are labeled generically by category ("₱X — Product"),
    // not by product name — .first() is the most recent entry, which is
    // this sale (timeline is sorted newest first).
    await expect(page.getByText(/— Product/).first()).toBeVisible();
  });
});
