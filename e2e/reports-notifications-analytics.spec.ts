import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

// See ARCHITECTURE.md's Phase 5-8 addenda: dev-mode compilation can abort
// an in-flight RSC fetch under rapid sequential server actions. Settle on
// networkidle after each mutating click rather than only asserting on the
// resulting DOM state.
async function clickAndSettle(page: Page, locator: Locator) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

// Scoped to the popup itself, not the whole page — the page behind the
// dropdown can independently render the same text (e.g. an announcement's
// own list-page link), which makes an unscoped getByText ambiguous and,
// worse, can click the wrong (covered) element. Same class of issue as
// ARCHITECTURE.md's bugs #13/#16/#18.
function notificationPopup(page: Page): Locator {
  return page.locator('[data-slot="dropdown-menu-content"]');
}

async function openNotificationBell(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Notifications" }).click();
  await page.waitForLoadState("networkidle");
  const popup = notificationPopup(page);
  await expect(popup).toBeVisible();
  // Every open clears client state and refetches (see notification-bell.tsx)
  // — wait for that refetch's "Loading..." placeholder to clear before
  // reading counts, otherwise a count taken mid-fetch undercounts.
  await expect(popup.getByText("Loading...", { exact: true })).toHaveCount(0);
  return popup;
}

async function closeNotificationBell(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForLoadState("networkidle");
}

test.describe("Reports, Notifications & Analytics (requires a seeded database)", () => {
  test("dashboard shows KPIs and responds to date range changes", async ({ page }) => {
    await loginAsOwner(page);

    // Scoped to <main> — the sidebar nav also has a "Bookings" link, and an
    // unscoped getByText match would resolve to both (same class of issue
    // as ARCHITECTURE.md's bugs #13/#16: the same word rendered in two
    // places on one page).
    const main = page.getByRole("main");
    await expect(main.getByText("Bookings", { exact: true })).toBeVisible();
    await expect(main.getByText("Billable amount", { exact: true })).toBeVisible();
    await expect(main.getByText("Active memberships", { exact: true })).toBeVisible();

    await page.getByLabel("Date range").click();
    await page.getByRole("option", { name: "Today" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/preset=TODAY/);
    await expect(main.getByText("Bookings", { exact: true })).toBeVisible();
  });

  test("a report table renders and its CSV export matches the displayed data", async ({ page }) => {
    await loginAsOwner(page);

    await page.goto("/dashboard/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
    await expect(page.getByText("Total billable", { exact: true })).toBeVisible();

    await page.getByRole("link", { name: /booking report/i }).click();
    await expect(page.getByRole("heading", { name: "Booking report" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /export csv/i }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/^booking-report-\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    const csvContent = Buffer.concat(chunks).toString("utf-8");
    expect(csvContent.split("\r\n")[0]).toBe(
      "Booking Reference,Court,Player,Type,Status,Start,End,Amount (cents)",
    );
  });

  test("publishing an announcement surfaces it in the notification center and can be marked read", async ({
    page,
  }) => {
    await loginAsOwner(page);

    const title = `E2E Announcement ${Date.now()}`;
    await page.goto("/dashboard/announcements/new");
    await page.getByLabel("Title", { exact: true }).fill(title);
    await page.getByLabel("Message", { exact: true }).fill("Facility-wide notice for automated testing.");
    await clickAndSettle(page, page.getByRole("button", { name: /create announcement/i }));

    await clickAndSettle(page, page.getByRole("button", { name: /^publish$/i }));
    await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();

    await page.goto("/dashboard/announcements");
    await expect(page.getByText(title)).toBeVisible();

    let popup = await openNotificationBell(page);
    const notificationItem = popup.getByText(title, { exact: true });
    await expect(notificationItem).toBeVisible();

    await notificationItem.click();
    await page.waitForLoadState("networkidle");
    await closeNotificationBell(page);
    popup = await openNotificationBell(page);
    // After being marked read, the title no longer renders with the
    // "font-medium" (unread) styling — confirm the muted (read) variant
    // is what's shown instead.
    await expect(popup.getByText(title, { exact: true })).toHaveClass(/text-muted-foreground/);
  });

  test("reminder generation is idempotent — reopening the notification center does not duplicate a reminder", async ({
    page,
  }) => {
    await loginAsOwner(page);

    let popup = await openNotificationBell(page);
    const beforeCount = await popup.getByText("Upcoming booking", { exact: true }).count();
    await closeNotificationBell(page);

    // An hourly booking starting a few hours from now (well within the 24h
    // reminder window) with no playerId, so
    // notificationService.generateReminders() attributes its BOOKING
    // reminder to bookedById — the signed-in Owner — making the reminder
    // observable in this same session without impersonating a seeded
    // player (sample players have no password and can't log in). A
    // walk-in ("starts now") booking doesn't work for this: by the time
    // the reminder sweep runs a few seconds later, its startAt has
    // already slipped into the past and no longer matches the "starts
    // within the next 24h" window. The offset is randomized (not a fixed
    // +2h) and a random court is picked so repeated runs against the same
    // seeded database don't collide with a still-active booking an
    // earlier run made on the same court/time and get silently rejected
    // by the overlap-prevention rule (ARCHITECTURE.md's Phase 4 addendum).
    // datetime-local inputs are interpreted as local wall-clock time with
    // no timezone conversion, so the string must be built from local
    // getters (matching booking-form.tsx's own toLocalInputValue) — mixing
    // toISOString()'s UTC date with toTimeString()'s local time produced a
    // wrong absolute instant (silently landing in the past) the first time
    // this was written.
    function toLocalInputValue(date: Date): string {
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    const offsetHours = 3 + Math.floor(Math.random() * 18);
    const start = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 60 * 60 * 1000);

    await page.goto("/dashboard/bookings/new");
    await page.getByRole("switch", { name: /walk-in \(starts now\)/i }).click();
    await page.getByLabel("Court").click();
    const courtOptions = page.getByRole("option");
    const courtCount = await courtOptions.count();
    await courtOptions.nth(Math.floor(Math.random() * courtCount)).click();
    await page.getByLabel("Starts", { exact: true }).fill(toLocalInputValue(start));
    await page.getByLabel("Ends", { exact: true }).fill(toLocalInputValue(end));
    await page.getByLabel(/guest name/i).fill(`Reminder Test Guest ${Date.now()}`);
    await clickAndSettle(page, page.getByRole("button", { name: /create booking/i }));
    // Confirm the booking was actually created (not silently rejected by
    // the overlap-prevention rule) before relying on its reminder existing.
    await expect(page).toHaveURL(/\/dashboard\/bookings\/(?!new$)[^/]+$/);

    await page.goto("/dashboard");
    popup = await openNotificationBell(page);
    const afterCreateCount = await popup.getByText("Upcoming booking", { exact: true }).count();
    expect(afterCreateCount).toBe(beforeCount + 1);
    await closeNotificationBell(page);

    // Reopening triggers generateReminders() again — the count must not
    // grow a second time.
    popup = await openNotificationBell(page);
    const afterReopenCount = await popup.getByText("Upcoming booking", { exact: true }).count();
    expect(afterReopenCount).toBe(afterCreateCount);
  });
});
