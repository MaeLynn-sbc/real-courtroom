import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";
import { enableModule } from "./helpers/enable-module";

// Direct e2e verification of the Phase 10 race-condition fixes (see
// ARCHITECTURE.md's Phase 10 addendum, item 18): booking, locker rental,
// equipment rental, and tournament bracket advancement each wrap a
// check-then-write pair in a Serializable transaction so that two
// near-simultaneous requests for the same resource can't both succeed.
// Each test below opens two independent browser contexts (separate
// sessions, like two staff members on two terminals) and fires the two
// mutating requests with Promise.all so they land on the server as close
// to simultaneously as real network/browser timing allows, then asserts
// exactly one side won.
//
// A one-shot `.isVisible()` or `page.url()` read right after
// waitForLoadState("networkidle") is not reliable here: the mutation is a
// React Server Action dispatched via startTransition, and "networkidle"
// can settle before the action's result has actually re-rendered the page
// (observed directly — a snapshot mid-race showed a still-disabled
// "Renting…" button). Every outcome below is instead determined by
// polling both the "win" and "lose" signals concurrently until one
// becomes visible, so the assertion only fires once the UI has genuinely
// settled either way. (An earlier try-win-then-catch-then-try-lose
// version chained two 20s waits sequentially and could exceed Playwright's
// default 30s test timeout mid-check — this polls both at once instead.)
async function determineOutcome(
  page: Page,
  checkWin: () => Promise<boolean> | boolean,
  checkLose: () => Promise<boolean> | boolean,
  timeoutMs = 20_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkWin()) return true;
    if (await checkLose()) return false;
    await page.waitForTimeout(250);
  }
  throw new Error("Neither the win nor the lose state appeared within the timeout.");
}

async function selectCourt(page: Page, courtName: string) {
  await page.getByLabel("Court").click();
  await page.getByRole("option", { name: courtName, exact: true }).click();
}

async function selectPlayer(page: Page, playerLabel: string) {
  await page.getByLabel("Player", { exact: true }).click();
  await page.getByRole("option", { name: playerLabel, exact: true }).click();
}

async function newContextPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

test.describe("Concurrency (requires a seeded database)", () => {
  // Setup (login, create fixtures) plus the up-to-20s outcome poll can run
  // close to the 30s default — give real headroom instead of chasing it.
  test.describe.configure({ timeout: 60_000 });

  test("booking: two simultaneous requests for the identical court/time slot — exactly one wins", async ({
    browser,
  }) => {
    const pageA = await newContextPage(browser);
    const pageB = await newContextPage(browser);
    await Promise.all([loginAsOwner(pageA), loginAsOwner(pageB)]);

    // Spread across a wide range of future days (not a fixed "tomorrow +2")
    // so repeated runs never collide with a booking a prior run already
    // created on the exact same court/date/time — that would make both
    // sides of *this* run's race lose against a leftover booking instead
    // of racing each other, which looks identical to a real failure
    // (aWon === bWon === false) but isn't one.
    const suffix = Date.now();
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 10 + (suffix % 300));
    const dateStr = bookingDate.toISOString().slice(0, 10);

    async function fillBookingForm(page: Page, guestName: string) {
      await page.goto("/dashboard/bookings/new");
      await page.getByRole("switch", { name: /walk-in \(starts now\)/i }).click();
      await selectCourt(page, "Court 2");
      await page.getByLabel("Starts", { exact: true }).fill(`${dateStr}T14:00`);
      await page.getByLabel("Ends", { exact: true }).fill(`${dateStr}T15:00`);
      await page.getByLabel(/guest name/i).fill(guestName);
    }

    await fillBookingForm(pageA, `Concurrency Guest A ${suffix}`);
    await fillBookingForm(pageB, `Concurrency Guest B ${suffix}`);

    const NOT_NEW_BOOKING_URL = /\/dashboard\/bookings\/(?!new$)[^/]+$/;
    const conflictText = /this court is already booked during the selected time/i;

    await Promise.all([
      pageA.getByRole("button", { name: /create booking/i }).click(),
      pageB.getByRole("button", { name: /create booking/i }).click(),
    ]);

    const [aWon, bWon] = await Promise.all([
      determineOutcome(
        pageA,
        () => NOT_NEW_BOOKING_URL.test(pageA.url()),
        () => pageA.getByText(conflictText).first().isVisible(),
      ),
      determineOutcome(
        pageB,
        () => NOT_NEW_BOOKING_URL.test(pageB.url()),
        () => pageB.getByText(conflictText).first().isVisible(),
      ),
    ]);

    expect(aWon !== bWon).toBe(true); // exactly one navigated to a booking detail page
    const loser = aWon ? pageB : pageA;
    await expect(loser.getByRole("heading", { name: "New booking" })).toBeVisible();
  });

  test("locker rental: two simultaneous rentals of the identical locker — exactly one wins", async ({
    browser,
  }) => {
    const pageA = await newContextPage(browser);
    const pageB = await newContextPage(browser);
    await Promise.all([loginAsOwner(pageA), loginAsOwner(pageB)]);
    await enableModule(pageA, "Locker Rental");

    const suffix = Date.now();
    const lockerCode = `CONC-${suffix}`;
    await pageA.goto("/dashboard/lockers/new");
    await pageA.getByLabel("Code", { exact: true }).fill(lockerCode);
    await pageA.getByRole("button", { name: /create locker/i }).click();
    await pageA.waitForURL(/\/dashboard\/lockers\/(?!new$)[^/]+$/);
    const lockerUrl = pageA.url();

    await pageB.goto(lockerUrl);
    await pageA.waitForLoadState("networkidle");

    await selectPlayer(pageA, "Kyle Domingo");
    await selectPlayer(pageB, "Lena Castillo");

    const aRef = pageA.getByRole("link", { name: /^LR-\d{8}-\d{4}$/ });
    const bRef = pageB.getByRole("link", { name: /^LR-\d{8}-\d{4}$/ });
    const conflictText = /already reserved during the requested time/i;

    await Promise.all([
      pageA.getByRole("button", { name: /^rent out$/i }).click(),
      pageB.getByRole("button", { name: /^rent out$/i }).click(),
    ]);

    const [aWon, bWon] = await Promise.all([
      determineOutcome(
        pageA,
        () => aRef.isVisible(),
        () => pageA.getByText(conflictText).first().isVisible(),
      ),
      determineOutcome(
        pageB,
        () => bRef.isVisible(),
        () => pageB.getByText(conflictText).first().isVisible(),
      ),
    ]);

    expect(aWon !== bWon).toBe(true); // exactly one rental reference appeared
  });

  test("equipment rental: two simultaneous rentals of a single-unit item — exactly one wins", async ({
    browser,
  }) => {
    const pageA = await newContextPage(browser);
    const pageB = await newContextPage(browser);
    await Promise.all([loginAsOwner(pageA), loginAsOwner(pageB)]);

    const suffix = Date.now();
    const equipmentName = `Concurrency Test Paddle ${suffix}`;
    await pageA.goto("/dashboard/equipment/new");
    await pageA.getByLabel("Name", { exact: true }).fill(equipmentName);
    const quantityInput = pageA.getByLabel("Quantity", { exact: true });
    await quantityInput.click({ clickCount: 3 });
    await quantityInput.press("Backspace");
    await quantityInput.pressSequentially("1");
    await pageA.getByRole("button", { name: /create equipment/i }).click();
    await pageA.waitForURL(/\/dashboard\/equipment\/(?!new$)[^/]+$/);
    const equipmentUrl = pageA.url();

    await pageB.goto(equipmentUrl);
    await pageA.waitForLoadState("networkidle");

    await selectPlayer(pageA, "Miko Navarro");
    await selectPlayer(pageB, "Nadia Ocampo");

    const aRef = pageA.getByRole("link", { name: /^ER-\d{8}-\d{4}$/ });
    const bRef = pageB.getByRole("link", { name: /^ER-\d{8}-\d{4}$/ });
    const unavailableText = /no units of this equipment are currently available/i;

    await Promise.all([
      pageA.getByRole("button", { name: /^rent out$/i }).click(),
      pageB.getByRole("button", { name: /^rent out$/i }).click(),
    ]);

    const [aWon, bWon] = await Promise.all([
      determineOutcome(
        pageA,
        () => aRef.isVisible(),
        () => pageA.getByText(unavailableText).first().isVisible(),
      ),
      determineOutcome(
        pageB,
        () => bRef.isVisible(),
        () => pageB.getByText(unavailableText).first().isVisible(),
      ),
    ]);

    expect(aWon !== bWon).toBe(true); // exactly one rental reference appeared
  });

  test("tournament bracket: two sibling round-1 matches completed simultaneously create exactly one round-2 match", async ({
    browser,
  }) => {
    const pageA = await newContextPage(browser);
    await loginAsOwner(pageA);
    await enableModule(pageA, "Tournament Registration");

    await pageA.goto("/dashboard/tournaments/new");
    const suffix = Date.now();
    const tournamentName = `E2E Concurrency Cup ${suffix}`;
    await pageA.getByLabel("Name", { exact: true }).fill(tournamentName);
    await pageA.getByRole("button", { name: /create tournament/i }).click();
    await pageA.waitForURL(/\/dashboard\/tournaments\/(?!new$)[^/]+$/);

    const categoryName = `Concurrency Category ${suffix}`;
    await pageA.getByLabel("Name", { exact: true }).fill(categoryName);
    await pageA.getByLabel("Format", { exact: true }).click();
    await pageA.getByRole("option", { name: "Single Elimination", exact: true }).click();
    await pageA.getByRole("button", { name: /^add category$/i }).click();
    await pageA.waitForLoadState("networkidle");

    await pageA.getByRole("link", { name: categoryName }).click();
    await pageA.waitForLoadState("networkidle");

    async function registerPlayer(page: Page, playerLabel: string) {
      await selectPlayer(page, playerLabel);
      await page.getByRole("button", { name: /^register team$/i }).click();
      await page.waitForLoadState("networkidle");
    }

    // Four teams -> round 1 has exactly 2 matches, both feeding the single
    // round-2 (final) slot — the shared resource being raced on.
    await registerPlayer(pageA, "Gio Fernandez");
    await registerPlayer(pageA, "Hana Torres");
    await registerPlayer(pageA, "Ivan Ramos");
    await registerPlayer(pageA, "Jia Aquino");

    await pageA.getByRole("button", { name: /generate bracket/i }).click();
    await pageA.waitForLoadState("networkidle");
    await expect(pageA.getByRole("heading", { name: "Round 1" })).toBeVisible();

    const categoryUrl = pageA.url();
    const pageB = await newContextPage(browser);
    await loginAsOwner(pageB);
    await pageB.goto(categoryUrl);

    const round1Cards = (page: Page): Locator =>
      page.locator('[data-slot="card"]').filter({ hasText: "vs" });

    await expect(round1Cards(pageA)).toHaveCount(2);
    await expect(round1Cards(pageB)).toHaveCount(2);

    // Score and save each sibling match from its own context first — only
    // the final "complete" write is meant to race.
    const cardA = round1Cards(pageA).nth(0);
    const cardB = round1Cards(pageB).nth(1);

    await cardA.getByRole("spinbutton").nth(0).fill("11");
    await cardA.getByRole("spinbutton").nth(1).fill("5");
    await cardA.getByRole("button", { name: /^save$/i }).first().click();
    await pageA.waitForLoadState("networkidle");

    await cardB.getByRole("spinbutton").nth(0).fill("11");
    await cardB.getByRole("spinbutton").nth(1).fill("5");
    await cardB.getByRole("button", { name: /^save$/i }).first().click();
    await pageB.waitForLoadState("networkidle");

    await Promise.all([
      cardA.getByRole("button", { name: /complete match/i }).click(),
      cardB.getByRole("button", { name: /complete match/i }).click(),
    ]);
    // Wait for each card's own UI to reflect completion — not just
    // "networkidle" — before trusting the DB state and reloading.
    await Promise.all([
      expect(cardA.getByText(/^winner:/i)).toBeVisible({ timeout: 20_000 }),
      expect(cardB.getByText(/^winner:/i)).toBeVisible({ timeout: 20_000 }),
    ]);

    await pageA.reload();
    await pageA.waitForLoadState("networkidle");
    await expect(pageA.getByRole("heading", { name: "Round 2" })).toBeVisible();
    // 2 round-1 matches + exactly 1 round-2 match — not two, and not zero.
    const allCards = await pageA.locator('[data-slot="card"]').filter({ hasText: "vs" }).count();
    expect(allCards).toBe(3);
  });
});
