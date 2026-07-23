import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";
import { enableModule } from "./helpers/enable-module";

const NOT_NEW_EQUIPMENT_URL = /\/dashboard\/equipment\/(?!new$)[^/]+$/;
const NOT_NEW_LOCKER_URL = /\/dashboard\/lockers\/(?!new$)[^/]+$/;

// See ARCHITECTURE.md's Phase 5-8 addenda: dev-mode compilation can abort
// an in-flight RSC fetch under rapid sequential server actions. Settle on
// networkidle after each mutating click rather than only asserting on the
// resulting DOM state.
async function clickAndSettle(page: Page, locator: Locator) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

test.describe("Equipment Rental & Locker Management (requires a seeded database)", () => {
  test("equipment: rent, damage report drives computed condition, resolve, return", async ({ page }) => {
    await loginAsOwner(page);

    const suffix = Date.now();
    const equipmentName = `E2E Test Paddle ${suffix}`;

    await page.goto("/dashboard/equipment/new");
    await page.getByLabel("Name", { exact: true }).fill(equipmentName);
    const quantityInput = page.getByLabel("Quantity", { exact: true });
    await quantityInput.click({ clickCount: 3 });
    await quantityInput.press("Backspace");
    await quantityInput.pressSequentially("1");
    await clickAndSettle(page, page.getByRole("button", { name: /create equipment/i }));
    await page.waitForURL(NOT_NEW_EQUIPMENT_URL);
    await expect(page.getByRole("heading", { name: equipmentName })).toBeVisible();
    await expect(page.getByText("1 / 1 available")).toBeVisible();
    // .first() because the Details form's Status select also defaults to
    // displaying "Available" as its current value on the same page.
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();

    // Rent out the single available unit.
    await page.getByLabel("Player", { exact: true }).click();
    await page.getByRole("option").first().click();
    await clickAndSettle(page, page.getByRole("button", { name: /^rent out$/i }));

    const rentalLink = page.getByRole("link", { name: /^ER-\d{8}-\d{4}$/ });
    await expect(rentalLink).toBeVisible();
    await expect(page.getByText("0 / 1 available")).toBeVisible();
    await expect(page.getByText("Rented", { exact: true })).toBeVisible();

    // Report damage — with nothing else available, condition becomes Damaged.
    await page.getByLabel("Maintenance type", { exact: true }).click();
    await page.getByRole("option", { name: "Damage report", exact: true }).click();
    await page.getByLabel("Note", { exact: true }).fill("Cracked frame reported by staff");
    await clickAndSettle(page, page.getByRole("button", { name: /^log entry$/i }));

    await expect(page.getByText("Damaged", { exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Damage report", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Open", exact: true })).toBeVisible();

    // Resolve the damage report — condition falls back to Rented (the
    // unit is still checked out, just no longer flagged as damaged).
    await clickAndSettle(page, page.getByRole("button", { name: /^resolve$/i }));
    await expect(page.getByRole("cell", { name: "Resolved", exact: true })).toBeVisible();
    await expect(page.getByText("Rented", { exact: true })).toBeVisible();

    // Return the rental — back to fully available.
    await clickAndSettle(page, page.getByRole("button", { name: /^return$/i }));
    await expect(page.getByText("1 / 1 available")).toBeVisible();
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();

    // Transaction history reflects the whole lifecycle.
    await expect(page.getByText(/^Rental$/).first()).toBeVisible();
    await expect(page.getByText(/^Return$/).first()).toBeVisible();
    await expect(page.getByText(/^Maintenance$/).first()).toBeVisible();
  });

  test("lockers: rent, overlap prevention, occupied status, end early", async ({ page }) => {
    await loginAsOwner(page);
    await enableModule(page, "Locker Rental");

    const suffix = Date.now();
    const lockerCode = `E2E-${suffix}`;

    await page.goto("/dashboard/lockers/new");
    await page.getByLabel("Code", { exact: true }).fill(lockerCode);
    await clickAndSettle(page, page.getByRole("button", { name: /create locker/i }));
    await page.waitForURL(NOT_NEW_LOCKER_URL);
    await expect(page.getByRole("heading", { name: lockerCode })).toBeVisible();
    // .first() because the Details form's Status select also defaults to
    // displaying "Available" as its current value on the same page.
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();

    await page.getByLabel("Player", { exact: true }).click();
    await page.getByRole("option").first().click();
    await clickAndSettle(page, page.getByRole("button", { name: /^rent out$/i }));

    const rentalLink = page.getByRole("link", { name: /^LR-\d{8}-\d{4}$/ });
    await expect(rentalLink).toBeVisible();
    await expect(page.getByText("Occupied", { exact: true })).toBeVisible();

    // A second, overlapping rental attempt for the same locker is rejected.
    await page.getByLabel("Player", { exact: true }).click();
    await page.getByRole("option").first().click();
    await clickAndSettle(page, page.getByRole("button", { name: /^rent out$/i }));
    // .first() — the same message appears both in the inline form error
    // and in the toast notification.
    await expect(page.getByText(/already reserved during the requested time/i).first()).toBeVisible();

    // Ending the rental early frees the locker back up.
    await clickAndSettle(page, page.getByRole("button", { name: /^end rental$/i }));
    await expect(page.getByText("Available", { exact: true }).first()).toBeVisible();
  });
});
