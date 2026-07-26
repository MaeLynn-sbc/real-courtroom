import { expect, test, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

// Phase 8 Gate 3. Every step here drives the real UI — including turning
// the prepayment switch on and back off — same convention as
// helpers/enable-module.ts's module toggles. A direct-service-import
// shortcut for fixture setup was tried and doesn't work in this project:
// Playwright's own TS transform can't load the generated Prisma client
// (import.meta incompatibility) the way `tsx` can for the integration
// suite, so real UI is the only way to get a proof into PENDING_
// VERIFICATION for this spec to test against — not just this suite's
// usual preference, a hard constraint here.
//
// No DB cleanup afterward — same accumulation-is-fine philosophy
// e2e/bookings.spec.ts's createFreshCourt already documents for this
// suite (unlike the integration suite's strict per-run cleanup). Unique,
// Date.now()-suffixed guest names keep this run's fixture findable
// across accumulated rows from prior runs.

// A minimal, real, decodable 1x1 PNG — not arbitrary bytes. The
// screenshot viewer renders this as a real <img>, and the hydration
// guard needs it to actually decode (naturalWidth > 0) to prove the
// authenticated route serves real image bytes, not just any bytes.
const FAKE_SCREENSHOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function setPrepaymentSwitch(page: Page, enabled: boolean): Promise<void> {
  await page.goto("/dashboard/admin/settings");
  const toggle = page.getByRole("switch", { name: "Require GCash prepayment for public bookings" });
  if ((await toggle.isChecked()) !== enabled) {
    await toggle.click();
    await page.waitForLoadState("networkidle");
  }
}

test.describe("Booking payment verification (requires a seeded database)", () => {
  test.afterAll(async ({ browser }) => {
    const page = await browser.newPage();
    await loginAsOwner(page);
    await setPrepaymentSwitch(page, false);
    await page.close();
  });

  test("hold -> staff records payment -> queue -> verify -> confirmed, with the hydration guard on the detail page", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await setPrepaymentSwitch(page, true);

    // Book publicly — the switch is on, so this must create a HOLD, not
    // an instant confirmation.
    const suffix = Date.now();
    const guestName = `E2E Verify Guest ${suffix}`;
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 200 + (suffix % 100));
    const dateStr = bookingDate.toISOString().slice(0, 10);

    await page.goto("/book");
    await page.getByLabel("Name", { exact: true }).fill(guestName);
    await page.getByLabel("Phone number", { exact: true }).fill(`0917${String(suffix).slice(-7)}`);
    await page.getByLabel("Date", { exact: true }).fill(dateStr);
    await page.getByLabel("Time", { exact: true }).fill("09:00");
    await page.getByRole("button", { name: /^book now$/i }).click();

    // The honesty fix: must NOT claim "Booking confirmed" for a hold.
    await expect(page.getByText(/slot held/i)).toBeVisible();
    await expect(page.getByText(/booking confirmed/i)).toHaveCount(0);
    const referenceLocator = page.locator("span.font-mono");
    const bookingReference = (await referenceLocator.textContent())?.trim();
    expect(bookingReference).toMatch(/^BK-\d{8}-\d{4}$/);

    // Find it on the staff side (date-filtered, so this run's fixture is
    // the only row) and confirm the honest AWAITING_PAYMENT status shows.
    await page.goto(`/dashboard/bookings?date=${dateStr}`);
    await page.getByRole("row").filter({ hasText: guestName }).getByRole("link").click();
    await expect(page.getByText("Awaiting Payment").first()).toBeVisible();

    // Staff records the GCash payment on the customer's behalf (no
    // public upload screen exists yet — BUILD-SPEC.md §8's proof-
    // submission UI is customer-facing and out of Gate 3's scope).
    const gcashReference = `E2E-GCASH-${suffix}`;
    await page.getByLabel("GCash reference number").fill(gcashReference);
    await page.getByLabel("Amount sent (₱)").fill("350");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: FAKE_SCREENSHOT_PNG });
    await page.getByRole("button", { name: /^submit payment$/i }).click();

    await expect(page.getByText(/waiting on staff verification/i)).toBeVisible();

    // The dashboard-wide badge reflects the new pending item.
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: /payment verification.*pending/i })).toBeVisible();

    // The queue lists it.
    await page.goto("/dashboard/bookings/verify-payments");
    await expect(page.getByRole("heading", { name: "Verify payments" })).toHaveCount(1);
    const queueRow = page.getByRole("row").filter({ hasText: guestName });
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole("link", { name: /review/i }).click();

    // Regression guard, same shape as e2e/bookings.spec.ts's — the exact
    // page BUILD-SPEC.md §15 named as needing this once Phase 8 landed
    // real approve/reject buttons here.
    await expect(page.getByRole("heading", { name: "Verify payment", level: 1 })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /reject payment/i })).toHaveCount(1);
    await expect(page.getByAltText("GCash payment confirmation screenshot")).toHaveCount(1);

    // Large, selectable reference number; full-size screenshot that
    // actually loads; expected vs submitted amount, no mismatch (both
    // ₱350).
    await expect(page.getByRole("button").filter({ hasText: gcashReference })).toBeVisible();
    const screenshot = page.getByAltText("GCash payment confirmation screenshot");
    await expect
      .poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(page.getByText("₱350.00").first()).toBeVisible();
    await expect(page.getByText("Doesn't match")).toHaveCount(0);

    await page.getByRole("button", { name: /approve/i }).click();
    await page.waitForURL("**/dashboard/bookings/verify-payments");

    // Confirmed, for real — a Sale exists, checkable via the booking
    // detail page's own status badge (already proven at the service
    // layer in Gate 2's integration tests; this proves the UI path).
    await page.goto(`/dashboard/bookings?date=${dateStr}`);
    await page.getByRole("row").filter({ hasText: guestName }).getByRole("link").click();
    await expect(page.getByText("Confirmed").first()).toBeVisible();
  });

  test("submitting an amount that doesn't match the booking total is flagged, not silently accepted", async ({
    page,
  }) => {
    await loginAsOwner(page);
    await setPrepaymentSwitch(page, true);

    const suffix = Date.now() + 1;
    const guestName = `E2E Amount Diff Guest ${suffix}`;
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 205 + (suffix % 100));
    const dateStr = bookingDate.toISOString().slice(0, 10);

    await page.goto("/book");
    await page.getByLabel("Name", { exact: true }).fill(guestName);
    await page.getByLabel("Phone number", { exact: true }).fill(`0918${String(suffix).slice(-7)}`);
    await page.getByLabel("Date", { exact: true }).fill(dateStr);
    await page.getByLabel("Time", { exact: true }).fill("09:00");
    await page.getByRole("button", { name: /^book now$/i }).click();
    await expect(page.getByText(/slot held/i)).toBeVisible();

    await page.goto(`/dashboard/bookings?date=${dateStr}`);
    await page.getByRole("row").filter({ hasText: guestName }).getByRole("link").click();

    const gcashReference = `E2E-MISMATCH-${suffix}`;
    await page.getByLabel("GCash reference number").fill(gcashReference);
    // Deliberately short — the expected amount is ₱350.
    await page.getByLabel("Amount sent (₱)").fill("300");
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: "proof.png", mimeType: "image/png", buffer: FAKE_SCREENSHOT_PNG });
    await page.getByRole("button", { name: /^submit payment$/i }).click();
    await expect(page.getByText(/waiting on staff verification/i)).toBeVisible();

    await page.goto("/dashboard/bookings/verify-payments");
    const queueRow = page.getByRole("row").filter({ hasText: guestName });
    await expect(queueRow.getByText("Mismatch")).toBeVisible();

    await queueRow.getByRole("link", { name: /review/i }).click();
    await expect(page.getByText("Doesn't match")).toBeVisible();
    await expect(page.getByText("₱350.00").first()).toBeVisible();
    await expect(page.getByText("₱300.00").first()).toBeVisible();
  });
});
