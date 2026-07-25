import { expect, test } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

// Full lifecycle for the pre-Phase-8 staff-accounts round: an admin
// creates an account with a system-generated temp password, the new
// employee is forced through change-password before reaching anything
// else, and a normal login resumes after the change. The page.goto()
// redirect assertions below ARE the "attempts to bypass" proof — direct
// URL navigation to a permission-gated page while mustChangePassword is
// still true, checked server-side (middleware.ts + lib/rbac.ts), not
// inferred from what the UI happens to show.
//
// Note on the immediate post-login check: right after signIn()'s own
// Server-Action redirect, Next.js's client router briefly shows the
// PRE-redirect URL (/dashboard) in the address bar while already
// rendering the middleware-redirected page's real content — confirmed
// via direct inspection (server logs show middleware correctly issuing
// the /dashboard/change-password redirect and the browser receiving its
// 200; only the visible URL lags for that one soft navigation). Checking
// the rendered heading instead of the URL there is deliberate, not a
// weaker assertion — the explicit page.goto() calls further down are
// genuine hard navigations and correctly assert on the URL too.
test.describe("Staff accounts (requires a seeded database)", () => {
  test("temp password → forced change → normal access, with the old password dead", async ({
    page,
    context,
  }) => {
    await loginAsOwner(page);

    const username = `e2e.staff.${Date.now()}`;
    await page.goto("/dashboard/admin/employees?employeeId=new");
    await page.getByLabel("First name").fill("E2E");
    await page.getByLabel("Last name").fill("Staff");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Role").click();
    await page.getByRole("option", { name: "Receptionist", exact: true }).click();
    await page.getByRole("button", { name: /create employee/i }).click();

    // The temp password reveal — shown exactly once.
    const tempPasswordLocator = page.locator("code");
    await expect(tempPasswordLocator).toBeVisible();
    const tempPassword = (await tempPasswordLocator.textContent())?.trim();
    expect(tempPassword).toBeTruthy();
    if (!tempPassword) throw new Error("temp password was not captured");

    await page.getByRole("button", { name: /i've saved this password/i }).click();

    // Sign out the Owner and log in as the brand-new employee.
    await context.clearCookies();
    await page.goto("/login");
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(tempPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Forced onto change-password, not the normal dashboard — see the
    // file-level comment on why this checks rendered content, not the URL.
    await expect(page.getByRole("heading", { name: "Change password", level: 1 })).toBeVisible();

    // Bypass attempt: a direct URL to a permission-gated page must still
    // redirect back here, server-side — mustChangePassword is still true.
    await page.goto("/dashboard/bookings");
    await page.waitForURL("**/dashboard/change-password");
    // And the bare dashboard root, not just a deeper path.
    await page.goto("/dashboard");
    await page.waitForURL("**/dashboard/change-password");

    const newPassword = "NewStaffPass123!";
    await page.getByLabel("Current password").fill(tempPassword);
    await page.getByLabel("New password", { exact: true }).fill(newPassword);
    await page.getByLabel("Confirm new password").fill(newPassword);
    await page.getByRole("button", { name: /change password/i }).click();

    // Forced sign-out on success, landing back at /login with the
    // confirmation message from the passwordChanged=1 query param.
    await page.waitForURL("**/login**");
    await expect(page.getByText(/password changed/i)).toBeVisible();

    // The dead temp password no longer works.
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(tempPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/invalid username or password/i)).toBeVisible();

    // The new password does, and mustChangePassword no longer blocks
    // normal permission-gated access — Receptionist has bookings:manage.
    await page.getByLabel(/username/i).fill(username);
    await page.getByLabel(/password/i).fill(newPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/dashboard");

    await page.goto("/dashboard/bookings");
    await expect(page).toHaveURL(/\/dashboard\/bookings$/);
  });
});
