import { expect, test, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

const NOT_NEW_BOOKING_URL = /\/dashboard\/bookings\/(?!new$)[^/]+$/;

async function selectCourt(page: Page, courtName: string) {
  await page.getByLabel("Court").click();
  await page.getByRole("option", { name: courtName, exact: true }).click();
}

// A walk-in booking always starts "now" with no way to pick a different
// time, so it can't be made collision-proof the way a scheduled booking can
// (see createHourlyBooking's suffix-varied date below). Re-running this
// test against a persistent dev database within the same hour as a prior
// run would otherwise collide with that prior run's still-active booking
// on a shared fixture court — so each run gets its own freshly-created,
// never-reused court instead.
async function createFreshCourt(page: Page): Promise<string> {
  const courtName = `E2E Booking Test Court ${Date.now()}`;
  await page.goto("/dashboard/courts/new");
  await page.getByLabel(/^name$/i).fill(courtName);
  await page.getByRole("button", { name: /create court/i }).click();
  await page.waitForURL("**/dashboard/courts/*");
  return courtName;
}

test.describe("Booking System (requires a seeded database)", () => {
  test("staff can create a walk-in booking and check it in", async ({ page }) => {
    await loginAsOwner(page);

    const courtName = await createFreshCourt(page);

    await page.goto("/dashboard/bookings/new");
    await expect(page.getByRole("heading", { name: "New booking" })).toBeVisible();

    await selectCourt(page, courtName);

    const guestName = `Walkin Guest ${Date.now()}`;
    await page.getByLabel(/guest name/i).fill(guestName);
    await page.getByRole("button", { name: /create booking/i }).click();

    await page.waitForURL(NOT_NEW_BOOKING_URL);
    await expect(page.getByText(/^BK-\d{8}-\d{4}$/)).toBeVisible();
    await expect(page.getByText("Confirmed").first()).toBeVisible();
    await expect(page.getByAltText("Booking check-in QR code")).toBeVisible();

    // Check in from the detail page's status actions.
    await page.getByRole("button", { name: /^check in$/i }).click();
    await expect(page.getByText("Checked In").first()).toBeVisible();

    // Confirm it's reflected in the bookings list too.
    await page.goto("/dashboard/bookings");
    await expect(page.getByText(guestName)).toBeVisible();
  });

  test("an overlapping hourly booking on the same court is rejected", async ({ page }) => {
    await loginAsOwner(page);

    const courtName = await createFreshCourt(page);

    // Spread across a wide range of future days rather than a fixed
    // "tomorrow" — re-running this test more than once on the same
    // calendar day would otherwise have "tomorrow" resolve to the same
    // date both times and collide with the previous run's own booking.
    const suffix = Date.now();
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 1 + (suffix % 300));
    const dateStr = bookingDate.toISOString().slice(0, 10);

    async function createHourlyBooking(start: string, end: string, guestName: string) {
      await page.goto("/dashboard/bookings/new");
      await page.getByRole("switch", { name: /walk-in \(starts now\)/i }).click();
      await selectCourt(page, courtName);
      await page.getByLabel("Starts", { exact: true }).fill(`${dateStr}T${start}`);
      await page.getByLabel("Ends", { exact: true }).fill(`${dateStr}T${end}`);
      await page.getByLabel(/guest name/i).fill(guestName);
      await page.getByRole("button", { name: /create booking/i }).click();
    }

    await createHourlyBooking("10:00", "11:00", `First Guest ${Date.now()}`);
    await page.waitForURL(NOT_NEW_BOOKING_URL);

    await createHourlyBooking("10:30", "11:30", `Second Guest ${Date.now()}`);

    await expect(
      page.getByText(/this court is already booked during the selected time/i).first(),
    ).toBeVisible();
    // Should not have navigated away from the form on failure.
    await expect(page.getByRole("heading", { name: "New booking" })).toBeVisible();
  });

  // Regression guard for a diagnosed dev-mode-only artifact (pre-Phase-8
  // review): a hard navigation to this page can transiently commit two
  // React roots for well under 200ms before settling to one — confirmed
  // via raw curl (server HTML always has exactly one of each filter
  // control) and via console output (no hydration-mismatch warning ever
  // fires; it's a doubled root-init, not a client/server markup
  // disagreement). `toHaveCount(1)` polls until the assertion holds, so
  // it tolerates that settle window — this exists to catch a REAL future
  // mismatch (e.g. once Phase 8 adds interactive verification-queue
  // buttons to this dashboard), not the harmless transient itself. Not
  // yet confirmed absent under a production build (that check broke
  // mid-attempt and isn't counted) — this test is what makes deferring
  // that confirmation safe: if the "dev-only" inference is wrong, it fails.
  test("the bookings list filter form settles to exactly one instance of each control", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await page.goto("/dashboard/bookings");

    await expect(page.locator("form")).toHaveCount(1);
    await expect(page.locator("#status")).toHaveCount(1);
    await expect(page.locator("#date")).toHaveCount(1);
    await expect(page.locator("#source")).toHaveCount(1);
    await expect(page.locator("#sort")).toHaveCount(1);
  });
});
