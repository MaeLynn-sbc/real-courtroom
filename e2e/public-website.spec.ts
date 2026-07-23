import { expect, test, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

async function clickAndSettle(page: Page, locator: ReturnType<Page["getByRole"]>) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

// The real default (services/settings/settings.service.ts's DEFAULT_HERO)
// — other specs (e.g. smoke.spec.ts) assert on this exact title.
const DEFAULT_HERO_TITLE = "THE COURTROOM";

test.describe("Public Website & Customer Booking (requires a seeded database)", () => {
  test("public pages render without auth", async ({ page }) => {
    for (const path of ["/", "/about", "/courts", "/rates", "/contact", "/availability", "/lookup"]) {
      await page.goto(path);
      expect(page.url()).not.toContain("/login");
      await expect(page.locator("header")).toBeVisible();
      await expect(page.locator("footer")).toBeVisible();
    }
  });

  test("responsive at mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await expect(page.getByRole("link", { name: /book now/i }).first()).toBeVisible();
    // No horizontal scroll at mobile width.
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasOverflow).toBe(false);
  });

  test("customer books a court publicly, staff sees it immediately, lookup finds it", async ({
    page,
  }) => {
    const suffix = Date.now();
    const guestName = `E2E Public Guest ${suffix}`;
    const guestPhone = `09${String(suffix).slice(-9)}`;

    // Book tomorrow at a time unlikely to collide with other e2e runs.
    const bookingDate = new Date();
    bookingDate.setDate(bookingDate.getDate() + 20 + (suffix % 100));
    const dateStr = bookingDate.toISOString().slice(0, 10);

    await page.goto("/book");
    await page.getByLabel("Name", { exact: true }).fill(guestName);
    await page.getByLabel("Phone number", { exact: true }).fill(guestPhone);
    await page.getByLabel("Date", { exact: true }).fill(dateStr);
    await page.getByLabel("Time", { exact: true }).fill("14:00");
    await clickAndSettle(page, page.getByRole("button", { name: /^book now$/i }));

    // CardTitle (components/ui/card.tsx) renders a plain <div>, not a
    // semantic heading — matches every other Card usage in this app, so
    // this is a text match, not a role="heading" match.
    await expect(page.getByText("Booking confirmed", { exact: true })).toBeVisible({ timeout: 20_000 });
    const referenceText = await page.locator("span.font-mono").first().textContent();
    const reference = referenceText?.trim();
    expect(reference).toMatch(/^BK-\d{8}-\d{4}$/);

    // Staff dashboard sees it immediately, same reference format. The
    // bookings list defaults to today — pass the booking's own date since
    // this booking is intentionally made for a future day.
    await loginAsOwner(page);
    await page.goto(`/dashboard/bookings?date=${dateStr}`);
    await expect(page.getByRole("link", { name: reference! })).toBeVisible();

    // Public lookup finds it by reference + phone.
    await page.goto(`/lookup?reference=${reference}&phone=${guestPhone}`);
    await expect(page.getByText(reference!)).toBeVisible();
    await expect(page.getByText(/^confirmed$/i)).toBeVisible();

    // Wrong phone number does not find it.
    await page.goto(`/lookup?reference=${reference}&phone=00000000000`);
    await expect(page.getByText(/no booking found/i)).toBeVisible();
  });

  // Own describe block so the cleanup afterEach only runs around this one
  // test — a full-suite afterEach would cost every other test in this
  // file an extra (unauthenticated, redirected-to-login) navigation.
  test.describe("CMS editing", () => {
    // Guaranteed cleanup for the hero title this test mutates, even if an
    // assertion above throws partway through — Playwright always runs
    // afterEach, unlike code placed after the point of failure in the
    // test body itself. Stays UI-driven (not a direct DB write): this
    // project's generated Prisma client can't load in the Playwright test
    // runner's module system, only inside the Next.js server process.
    test.afterEach(async ({ page }) => {
      await loginAsOwner(page);
      await page.goto("/dashboard/admin/website");
      const titleInput = page.getByLabel("Hero title", { exact: true });
      const current = await titleInput.inputValue().catch(() => null);
      if (current && current.startsWith("E2E HERO ")) {
        await titleInput.fill(DEFAULT_HERO_TITLE);
        await page.getByRole("button", { name: /^save$/i }).first().click();
        await expect(page.getByRole("button", { name: /^save$/i }).first()).toHaveText("Save", {
          timeout: 20_000,
        });
      }
    });

    test("Owner edits CMS content and it appears live on the public site", async ({ page }) => {
      const suffix = Date.now();
      const newTitle = `E2E HERO ${suffix}`;

      await loginAsOwner(page);
      await page.goto("/dashboard/admin/website");
      const saveButton = page.getByRole("button", { name: /^save$/i }).first();
      const titleInput = page.getByLabel("Hero title", { exact: true });
      await titleInput.fill(newTitle);
      await expect(titleInput).toHaveValue(newTitle);
      await saveButton.click();
      // Wait for the transition to actually finish (button reverts from
      // "Saving…" back to "Save") rather than trusting networkidle timing —
      // router.refresh()'s own fetch can start just after the network goes
      // briefly idle, which networkidle alone can miss.
      await expect(saveButton).toHaveText("Save", { timeout: 20_000 });

      await page.goto("/");
      await expect(page.getByRole("heading", { name: newTitle })).toBeVisible({ timeout: 20_000 });
      // Restoring the real hero title so it doesn't leak into other specs
      // happens unconditionally in afterEach above, not here — so it still
      // runs even if an assertion above this point throws.
    });
  });

  test("toggling public visibility hides the corresponding section", async ({ page }) => {
    await loginAsOwner(page);
    await page.goto("/dashboard/admin/website");

    const openPlayToggle = page.getByRole("switch", { name: "Open Play" });
    const wasVisible = await openPlayToggle.isChecked();
    if (wasVisible) {
      await openPlayToggle.click();
      await expect(openPlayToggle).not.toBeChecked({ timeout: 20_000 });
    }

    await page.goto("/open-play");
    await expect(page.getByText(/aren.t available online/i)).toBeVisible({ timeout: 20_000 });

    // Restore state for other runs.
    await page.goto("/dashboard/admin/website");
    const toggleAfter = page.getByRole("switch", { name: "Open Play" });
    if (!(await toggleAfter.isChecked())) {
      await toggleAfter.click();
      await expect(toggleAfter).toBeChecked({ timeout: 20_000 });
    }
  });
});
