import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";
import { enableModule } from "./helpers/enable-module";

const NOT_NEW_PLAYER_URL = /\/dashboard\/players\/(?!new$)[^/]+$/;

// See ARCHITECTURE.md's Phase 5/6/7 addenda: dev-mode compilation can
// abort an in-flight RSC fetch under rapid sequential server actions.
// Settle on networkidle after each mutating click rather than only
// asserting on the resulting DOM state.
async function clickAndSettle(page: Page, locator: Locator) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

test.describe("Membership & Player Management (requires a seeded database)", () => {
  test("create a player, enroll a membership, renew, upgrade, suspend, and reactivate", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await enableModule(page, "Membership");

    const suffix = Date.now();
    const playerName = `E2E Test Player ${suffix}`;
    const playerEmail = `e2e.player.${suffix}@players.thecourtroom.local`;

    await page.goto("/dashboard/players/new");
    await page.getByLabel("Name", { exact: true }).fill(playerName);
    await page.getByLabel("Email", { exact: true }).fill(playerEmail);
    await clickAndSettle(page, page.getByRole("button", { name: /create player/i }));
    await page.waitForURL(NOT_NEW_PLAYER_URL);
    await expect(page.getByRole("heading", { name: playerName })).toBeVisible();

    // Stats dashboard renders for a brand-new player (all zeros). "Tournament
    // Wins" is unambiguous, unlike "Bookings" which also matches the nav link.
    await expect(page.getByText("Tournament Wins", { exact: true })).toBeVisible();
    await expect(page.getByText("No activity yet.")).toBeVisible();

    // Search finds the new player from the list page.
    await page.goto(`/dashboard/players?query=${encodeURIComponent(playerName)}`);
    await expect(page.getByRole("link", { name: playerName })).toBeVisible();
    await page.getByRole("link", { name: playerName }).click();
    await page.waitForLoadState("networkidle");

    // Enroll in the Silver plan.
    await page.getByLabel("Plan", { exact: true }).click();
    await page.getByRole("option", { name: "Silver", exact: true }).click();
    await clickAndSettle(page, page.getByRole("button", { name: /enroll membership/i }));

    const membershipLink = page.getByRole("link", { name: /^MB-\d{8}-\d{4}$/ });
    await expect(membershipLink).toBeVisible();
    await membershipLink.click();
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /^MB-\d{8}-\d{4}$/ })).toBeVisible();
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();

    // Renew.
    await clickAndSettle(page, page.getByRole("button", { name: /^renew$/i }));
    await expect(page.getByRole("cell", { name: "Renewed", exact: true })).toBeVisible();

    // Change to the higher-priced Gold plan — logs an Upgraded event.
    await page.getByLabel("Change plan", { exact: true }).click();
    await page.getByRole("option", { name: "Gold", exact: true }).click();
    await clickAndSettle(page, page.getByRole("button", { name: /^change plan$/i }));
    await expect(page.getByRole("cell", { name: "Upgraded", exact: true })).toBeVisible();

    // Suspend, then reactivate.
    await clickAndSettle(page, page.getByRole("button", { name: /^suspend$/i }));
    await expect(page.getByText("Cancelled", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Suspended", exact: true })).toBeVisible();

    await clickAndSettle(page, page.getByRole("button", { name: /^reactivate$/i }));
    await expect(page.getByText("Active", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "Reactivated", exact: true })).toBeVisible();
  });
});
