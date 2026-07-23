import type { Page } from "@playwright/test";

// v1.1: staff sign in with an admin-issued username/password, not email —
// consolidated here since every spec's own copy of this helper needed the
// same field-name change anyway.
const OWNER_USERNAME = "owner";
const OWNER_PASSWORD = "Owner123!";

// Seeded Receptionist account (prisma/seed.ts) — used where a test needs
// a non-Owner staff login, e.g. to exercise the "My shift" dashboard
// panel Owner no longer sees.
const STAFF_USERNAME = "staff";
const STAFF_PASSWORD = "Staff123!";

async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard");
}

export async function loginAsOwner(page: Page): Promise<void> {
  await login(page, OWNER_USERNAME, OWNER_PASSWORD);
}

export async function loginAsStaff(page: Page): Promise<void> {
  await login(page, STAFF_USERNAME, STAFF_PASSWORD);
}
