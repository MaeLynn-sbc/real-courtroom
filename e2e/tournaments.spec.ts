import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";
import { enableModule } from "./helpers/enable-module";

const NOT_NEW_TOURNAMENT_URL = /\/dashboard\/tournaments\/(?!new$)[^/]+$/;

// See ARCHITECTURE.md's Phase 5/6 addenda: dev-mode compilation can abort
// an in-flight RSC fetch under rapid sequential server actions. Settle on
// networkidle after each mutating click rather than only asserting on the
// resulting DOM state.
async function clickAndSettle(page: Page, locator: Locator) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

async function selectPlayer(page: Page, playerLabel: string) {
  await page.getByLabel("Player", { exact: true }).click();
  await page.getByRole("option", { name: playerLabel, exact: true }).click();
}

async function registerPlayer(page: Page, playerLabel: string) {
  await selectPlayer(page, playerLabel);
  await clickAndSettle(page, page.getByRole("button", { name: /^register team$/i }));
  // Scoped to the Registrations table specifically (the first table on the
  // page) — the Standings table below it also lists every confirmed team
  // by name once registered, even before any matches exist, so an
  // unscoped page-wide lookup is ambiguous.
  await expect(
    page.locator("table").first().getByRole("cell", { name: playerLabel, exact: true }),
  ).toBeVisible();
}

test.describe("Tournament Management (requires a seeded database)", () => {
  test("Round Robin: register 3 teams, generate the bracket, complete every match, see standings", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await enableModule(page, "Tournament Registration");

    await page.goto("/dashboard/tournaments/new");
    const suffix = Date.now();
    const tournamentName = `E2E Round Robin Cup ${suffix}`;
    await page.getByLabel("Name", { exact: true }).fill(tournamentName);
    await clickAndSettle(page, page.getByRole("button", { name: /create tournament/i }));
    await page.waitForURL(NOT_NEW_TOURNAMENT_URL);
    await expect(page.getByRole("heading", { name: tournamentName })).toBeVisible();

    const categoryName = `RR Category ${suffix}`;
    await page.getByLabel("Name", { exact: true }).fill(categoryName);
    // Format defaults to Round Robin already.
    await clickAndSettle(page, page.getByRole("button", { name: /^add category$/i }));

    await page.getByRole("link", { name: categoryName }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { name: categoryName })).toBeVisible();

    await registerPlayer(page, "Alex Santos");
    await registerPlayer(page, "Bea Cruz");
    await registerPlayer(page, "Carlo Reyes");

    await clickAndSettle(page, page.getByRole("button", { name: /generate bracket/i }));

    const matchCards = page.locator('[data-slot="card"]').filter({ hasText: "vs" });
    await expect(matchCards).toHaveCount(3);

    for (let i = 0; i < 3; i += 1) {
      const card = matchCards.nth(i);
      await card.getByRole("spinbutton").nth(0).fill("11");
      await card.getByRole("spinbutton").nth(1).fill("5");
      await clickAndSettle(page, card.getByRole("button", { name: /^save$/i }).first());
      await clickAndSettle(page, card.getByRole("button", { name: /complete match/i }));
      await expect(card.getByText(/^winner:/i)).toBeVisible();
    }

    const standingsRows = page.locator("table").last().locator("tbody tr");
    await expect(standingsRows).toHaveCount(3);
  });

  test("Single Elimination: an odd team count byes one team, and round 2 is created once round 1 finishes", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await enableModule(page, "Tournament Registration");

    await page.goto("/dashboard/tournaments/new");
    const suffix = Date.now();
    const tournamentName = `E2E Elimination Cup ${suffix}`;
    await page.getByLabel("Name", { exact: true }).fill(tournamentName);
    await clickAndSettle(page, page.getByRole("button", { name: /create tournament/i }));
    await page.waitForURL(NOT_NEW_TOURNAMENT_URL);

    const categoryName = `SE Category ${suffix}`;
    await page.getByLabel("Name", { exact: true }).fill(categoryName);
    await page.getByLabel("Format", { exact: true }).click();
    await page.getByRole("option", { name: "Single Elimination", exact: true }).click();
    await clickAndSettle(page, page.getByRole("button", { name: /^add category$/i }));

    await page.getByRole("link", { name: categoryName }).click();
    await page.waitForLoadState("networkidle");

    await registerPlayer(page, "Dana Villanueva");
    await registerPlayer(page, "Erik Bautista");
    await registerPlayer(page, "Faye Mendoza");

    await clickAndSettle(page, page.getByRole("button", { name: /generate bracket/i }));

    await expect(page.getByRole("heading", { name: "Round 1" })).toBeVisible();
    await expect(page.getByText("Automatic bye")).toBeVisible();

    const round1RealMatch = page.locator('[data-slot="card"]').filter({ hasText: "vs" });
    await expect(round1RealMatch).toHaveCount(1);

    await round1RealMatch.getByRole("spinbutton").nth(0).fill("11");
    await round1RealMatch.getByRole("spinbutton").nth(1).fill("6");
    await clickAndSettle(page, round1RealMatch.getByRole("button", { name: /^save$/i }).first());
    await clickAndSettle(page, round1RealMatch.getByRole("button", { name: /complete match/i }));

    await expect(page.getByRole("heading", { name: "Round 2" })).toBeVisible();
  });
});
