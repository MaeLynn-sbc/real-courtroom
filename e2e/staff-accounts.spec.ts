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

  // Follow-up finding from this round's review: the jwt() callback
  // originally only re-checked passwordChangedAt on every request, not
  // Employee.isActive — meaning a deactivated employee's EXISTING token
  // kept its full permissions until it naturally expired, even though
  // authorize() already refuses a brand-new sign-in for the same account.
  // Confirmed live via /api/auth/session with the deactivated employee's
  // own stale cookies before fixing auth.ts, then fixed by extending the
  // exact same per-request check passwordChangedAt already used. This
  // test is what keeps that fixed — an existing employee session must
  // stop working the next time it hits the server, not just at its next
  // login.
  test("deactivating an employee invalidates their existing session on the next request", async ({
    browser,
  }) => {
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await loginAsOwner(ownerPage);

    const username = `e2e.deactivate.${Date.now()}`;
    await ownerPage.goto("/dashboard/admin/employees?employeeId=new");
    await ownerPage.getByLabel("First name").fill("E2E");
    await ownerPage.getByLabel("Last name").fill("Deactivate");
    await ownerPage.getByLabel("Username").fill(username);
    await ownerPage.getByLabel("Role").click();
    await ownerPage.getByRole("option", { name: "Receptionist", exact: true }).click();
    await ownerPage.getByRole("button", { name: /create employee/i }).click();
    const tempPasswordLocator = ownerPage.locator("code");
    await expect(tempPasswordLocator).toBeVisible();
    const tempPassword = (await tempPasswordLocator.textContent())?.trim();
    if (!tempPassword) throw new Error("temp password was not captured");
    await ownerPage.getByRole("button", { name: /i've saved this password/i }).click();
    await ownerPage.waitForURL(/employeeId=(?!new)/);
    const employeeUrl = ownerPage.url();

    // A separate browser context — this employee's own "device," whose
    // session must never get read from or written to by the Owner's.
    const empContext = await browser.newContext();
    const empPage = await empContext.newPage();
    await empPage.goto("/login");
    await empPage.getByLabel(/username/i).fill(username);
    await empPage.getByLabel(/password/i).fill(tempPassword);
    await empPage.getByRole("button", { name: /sign in/i }).click();
    await empPage.getByLabel("Current password").fill(tempPassword);
    await empPage.getByLabel("New password", { exact: true }).fill("EmployeePass123!");
    await empPage.getByLabel("Confirm new password").fill("EmployeePass123!");
    await empPage.getByRole("button", { name: /change password/i }).click();
    await empPage.waitForURL("**/login**");
    await empPage.getByLabel(/username/i).fill(username);
    await empPage.getByLabel(/password/i).fill("EmployeePass123!");
    await empPage.getByRole("button", { name: /sign in/i }).click();
    await empPage.waitForURL("**/dashboard");

    const beforeSession = await (
      await empPage.request.get("/api/auth/session", { headers: { "cache-control": "no-cache" } })
    ).json();
    expect(beforeSession.user?.permissions).toContain("bookings:manage");

    // Owner deactivates — the employee's tab never reloads, never learns
    // this happened client-side. Waits on the actual setEmployeeActiveAction
    // response (not a page-wide "Inactive" text match — the employee list
    // panel on this same page can have OTHER already-inactive employees
    // from unrelated fixtures, which would make that check pass
    // immediately without ever waiting for THIS write).
    await ownerPage.goto(employeeUrl);
    await Promise.all([
      ownerPage.waitForResponse(
        (res) => res.url().includes("/dashboard/admin/employees") && res.request().method() === "POST",
      ),
      ownerPage.getByRole("switch").click(),
    ]);

    // The employee's stale cookies, asked fresh — this is a live
    // server-side auth() call, not a cached client read. A discarded
    // token (jwt() callback returned null) serializes as a bare `null`
    // body, not an empty user object.
    const afterSession = await (
      await empPage.request.get("/api/auth/session", { headers: { "cache-control": "no-cache" } })
    ).json();
    expect(afterSession).toBeNull();

    await ownerContext.close();
    await empContext.close();
  });
});
