import { expect, test } from "@playwright/test";

test.describe("Phase 1 smoke tests", () => {
  test("landing page renders", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /the courtroom/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i }).first()).toBeVisible();
  });

  test("login page renders the sign-in form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel(/username/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
  });

  test("unauthenticated users are redirected away from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard/);
  });

  test("health check endpoint responds", async ({ request }) => {
    const response = await request.get("/api/health");
    const body = (await response.json()) as { status: string };
    expect(["ok", "error"]).toContain(body.status);
  });
});
