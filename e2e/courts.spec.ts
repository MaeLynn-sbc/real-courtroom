import { expect, test } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

test.describe("Court Management (requires a seeded database)", () => {
  test("Owner can sign in and reach the dashboard", async ({ page }) => {
    await loginAsOwner(page);
    await expect(page.getByRole("heading", { name: /welcome/i })).toBeVisible();
  });

  test("Courts list shows the seeded courts", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/dashboard/courts");
    await expect(page.getByRole("heading", { name: "Courts" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Court 1", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "New court" })).toBeVisible();
  });

  test("Owner can open a court detail page and see manage controls", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/dashboard/courts");
    await page.getByRole("link", { name: "Court 1", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Court 1", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /edit court/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /schedule maintenance/i })).toBeVisible();
  });

  test("Owner can create a new court", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/dashboard/courts/new");
    await expect(page.getByRole("heading", { name: "New court" })).toBeVisible();

    const uniqueName = `E2E Test Court ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(uniqueName);
    await page.getByRole("button", { name: /create court/i }).click();

    await page.waitForURL("**/dashboard/courts/*");
    await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();
  });
});
