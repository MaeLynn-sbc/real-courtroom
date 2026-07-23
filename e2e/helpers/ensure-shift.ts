import type { Page } from "@playwright/test";

// Every sale-producing action requires the caller to have a currently
// open Shift. Idempotent — does nothing if one is already open.
export async function ensureOpenShift(page: Page): Promise<void> {
  await page.goto("/dashboard/shift");
  const startButton = page.getByRole("button", { name: /^start shift$/i });
  if (await startButton.isVisible().catch(() => false)) {
    await startButton.click();
    await page.waitForLoadState("networkidle");
  }
}
