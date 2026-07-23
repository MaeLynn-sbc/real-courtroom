import type { Page } from "@playwright/test";

// Module toggles default OFF (see lib/module-flags.ts) — specs that
// exercise membership enrollment, locker rental, or tournament
// registration need to turn their module on first, through the real
// admin UI, same as every other piece of e2e setup in this suite.
export async function enableModule(
  page: Page,
  moduleLabel: "Membership" | "Locker Rental" | "Tournament Registration",
): Promise<void> {
  await page.goto("/dashboard/admin/settings");
  const toggle = page.getByRole("switch", { name: moduleLabel, exact: true });
  if (!(await toggle.isChecked())) {
    await toggle.click();
    await page.waitForLoadState("networkidle");
  }
}
