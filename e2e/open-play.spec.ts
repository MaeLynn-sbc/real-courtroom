import { expect, test, type Locator, type Page } from "@playwright/test";

import { loginAsOwner } from "./helpers/auth";

const NOT_NEW_SESSION_URL = /\/dashboard\/open-play\/(?!new$)[^/]+$/;

function registrationRow(page: Page, guestName: string) {
  return page.getByRole("row", { name: new RegExp(guestName) });
}

// Every mutating action here goes through a server action that calls
// router.refresh(), which re-fetches the RSC payload for this
// first-time-compiled route. In dev mode, firing the next action before
// that refresh (and any still-settling webpack compile behind it) is done
// can abort the in-flight request — settle on networkidle after each click
// rather than only asserting on the resulting DOM state.
async function clickAndSettle(page: Page, locator: Locator) {
  await locator.click();
  await page.waitForLoadState("networkidle");
}

async function registerGuest(page: Page, guestName: string) {
  await page.getByLabel(/guest name/i).fill(guestName);
  await clickAndSettle(page, page.getByRole("button", { name: /^register$/i }));
  await expect(registrationRow(page, guestName)).toBeVisible();
}

async function statValue(page: Page, label: string): Promise<string | null> {
  return page
    .getByText(label, { exact: true })
    .locator("xpath=preceding-sibling::span[1]")
    .textContent();
}

test.describe("Open Play (requires a seeded database)", () => {
  test("full rotation: register, waitlist, check-in, match, and rest cycle", async ({ page }) => {
    await loginAsOwner(page);

    await page.goto("/dashboard/open-play/new");
    await expect(page.getByRole("heading", { name: "New Open Play session" })).toBeVisible();
    // The capacity field has a non-empty default value — select all before
    // typing so the new value replaces it instead of appending.
    const capacityInput = page.getByLabel("Capacity");
    await capacityInput.click({ clickCount: 3 });
    await capacityInput.press("Backspace");
    await capacityInput.pressSequentially("4");
    await expect(capacityInput).toHaveValue("4");
    await page.getByRole("button", { name: /create session/i }).click();

    await page.waitForURL(NOT_NEW_SESSION_URL);
    await expect(page.getByRole("heading", { name: /^OP-\d{8}-\d{4}$/ })).toBeVisible();
    // The session detail page pulls in a large, first-time-compiled
    // component graph (rotation board, registration list/form, stats bar,
    // etc.) — let dev-mode webpack finish compiling before the timed
    // interactions below, or fast follow-up navigations can get aborted
    // mid-compile (see ARCHITECTURE.md's Phase 5 addendum).
    await page.waitForLoadState("networkidle");

    const suffix = Date.now();
    const guests = Array.from({ length: 5 }, (_, i) => `OpenPlay Guest ${suffix}-${i + 1}`);

    for (const guestName of guests) {
      await registerGuest(page, guestName);
    }

    // Capacity is 4: the 5th registrant lands on the waitlist.
    for (const guestName of guests.slice(0, 4)) {
      await expect(registrationRow(page, guestName).getByText("Registered")).toBeVisible();
    }
    await expect(registrationRow(page, guests[4]).getByText("Waitlisted")).toBeVisible();

    // Check in the first 4 — each joins the Waiting queue.
    for (const guestName of guests.slice(0, 4)) {
      await clickAndSettle(
        page,
        registrationRow(page, guestName).getByRole("button", { name: /^check in$/i }),
      );
      await expect(registrationRow(page, guestName).getByText("Checked In")).toBeVisible();
    }
    await expect(async () => {
      expect(await statValue(page, "Waiting")).toBe("4");
    }).toPass();

    // Cancelling a checked-in guest frees a slot and promotes the waitlisted guest.
    await clickAndSettle(
      page,
      registrationRow(page, guests[0]).getByRole("button", { name: /^cancel$/i }),
    );
    await expect(registrationRow(page, guests[0]).getByText("Cancelled")).toBeVisible();
    await expect(registrationRow(page, guests[4]).getByText("Registered")).toBeVisible();
    await expect(async () => {
      expect(await statValue(page, "Waiting")).toBe("3");
    }).toPass();

    // Check in the promoted guest so there are 4 waiting again.
    await clickAndSettle(
      page,
      registrationRow(page, guests[4]).getByRole("button", { name: /^check in$/i }),
    );
    await expect(async () => {
      expect(await statValue(page, "Waiting")).toBe("4");
    }).toPass();

    // Start the next match: assigns a court and moves the group to Playing.
    await clickAndSettle(page, page.getByRole("button", { name: /start next match/i }));
    await expect(async () => {
      expect(await statValue(page, "Playing")).toBe("4");
      expect(await statValue(page, "Waiting")).toBe("0");
      expect(await statValue(page, "Active Matches")).toBe("1");
    }).toPass();

    // End the match: the group moves to Resting.
    await clickAndSettle(page, page.getByRole("button", { name: /^end match$/i }));
    await expect(async () => {
      expect(await statValue(page, "Resting")).toBe("4");
      expect(await statValue(page, "Playing")).toBe("0");
      expect(await statValue(page, "Active Matches")).toBe("0");
    }).toPass();

    // Returning one player from Resting sends them to the back of Waiting.
    await clickAndSettle(page, page.getByRole("button", { name: /return to queue/i }).first());
    await expect(async () => {
      expect(await statValue(page, "Waiting")).toBe("1");
      expect(await statValue(page, "Resting")).toBe("3");
    }).toPass();
  });
});
