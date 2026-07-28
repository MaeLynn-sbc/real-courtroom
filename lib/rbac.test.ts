import { CHANGE_PASSWORD_PATH, canAccessRoute, requiresPasswordChangeRedirect } from "@/lib/rbac";
import { PERMISSIONS } from "@/types/permissions";

describe("canAccessRoute", () => {
  it("allows unprotected routes for anyone", () => {
    expect(canAccessRoute("/", false, [])).toBe("allowed");
  });

  it("requires authentication for protected routes", () => {
    expect(canAccessRoute("/dashboard", false, [])).toBe("unauthenticated");
  });

  it("denies authenticated users without the required permission", () => {
    expect(canAccessRoute("/dashboard", true, [])).toBe("forbidden");
  });

  it("allows authenticated users with the required permission", () => {
    expect(canAccessRoute("/dashboard", true, [PERMISSIONS.DASHBOARD_ACCESS])).toBe("allowed");
  });

  it("matches nested paths under a protected prefix", () => {
    expect(canAccessRoute("/dashboard/settings", true, [PERMISSIONS.DASHBOARD_ACCESS])).toBe(
      "allowed",
    );
  });

  it("requires the more specific permission for a nested route with a stricter rule", () => {
    expect(canAccessRoute("/dashboard/courts/new", true, [PERMISSIONS.DASHBOARD_ACCESS])).toBe(
      "forbidden",
    );
    expect(
      canAccessRoute("/dashboard/courts/new", true, [
        PERMISSIONS.DASHBOARD_ACCESS,
        PERMISSIONS.COURTS_MANAGE,
      ]),
    ).toBe("allowed");
  });

  it("falls back to the parent rule for sibling routes that aren't the nested one", () => {
    expect(canAccessRoute("/dashboard/courts", true, [PERMISSIONS.DASHBOARD_ACCESS])).toBe(
      "allowed",
    );
  });

  it("gates the entire bookings section, not just a sub-route, unlike courts", () => {
    expect(canAccessRoute("/dashboard/bookings", true, [PERMISSIONS.DASHBOARD_ACCESS])).toBe(
      "forbidden",
    );
    expect(
      canAccessRoute("/dashboard/bookings/abc123", true, [PERMISSIONS.DASHBOARD_ACCESS]),
    ).toBe("forbidden");
    expect(
      canAccessRoute("/dashboard/bookings", true, [
        PERMISSIONS.DASHBOARD_ACCESS,
        PERMISSIONS.BOOKINGS_MANAGE,
      ]),
    ).toBe("allowed");
  });

  it("gates coaching availability/rates more strictly than the coaching sessions list", () => {
    expect(canAccessRoute("/dashboard/coaching", true, [PERMISSIONS.BOOKINGS_MANAGE])).toBe(
      "allowed",
    );
    expect(
      canAccessRoute("/dashboard/coaching/availability", true, [PERMISSIONS.BOOKINGS_MANAGE]),
    ).toBe("forbidden");
    expect(
      canAccessRoute("/dashboard/coaching/availability", true, [
        PERMISSIONS.COACHING_MANAGE_OWN_AVAILABILITY,
      ]),
    ).toBe("allowed");
    expect(canAccessRoute("/dashboard/coaching/rates", true, [PERMISSIONS.BOOKINGS_MANAGE])).toBe(
      "forbidden",
    );
    expect(
      canAccessRoute("/dashboard/coaching/rates", true, [PERMISSIONS.COACHING_MANAGE_RATES]),
    ).toBe("allowed");
  });

  it("gates GCash reconciliation more strictly than the /dashboard/admin parent (SYSTEM_ADMIN)", () => {
    expect(
      canAccessRoute("/dashboard/admin/gcash-reconciliation", true, [PERMISSIONS.SYSTEM_ADMIN]),
    ).toBe("forbidden");
    expect(
      canAccessRoute("/dashboard/admin/gcash-reconciliation", true, [
        PERMISSIONS.ACCOUNTS_CONFIRM_GCASH_RECONCILIATION,
      ]),
    ).toBe("allowed");
  });

  it("gates expenses on its own permission, not the /dashboard/admin parent's SYSTEM_ADMIN default", () => {
    expect(canAccessRoute("/dashboard/admin/expenses", true, [PERMISSIONS.SYSTEM_ADMIN])).toBe(
      "forbidden",
    );
    expect(
      canAccessRoute("/dashboard/admin/expenses", true, [PERMISSIONS.ACCOUNTS_RECORD_EXPENSE]),
    ).toBe("allowed");
  });

  // The page itself says "staff can view, owner can edit" (BUILD-SPEC.md
  // §13) — any signed-in staff member should reach it, same floor as
  // /dashboard itself, not the /dashboard/admin parent's SYSTEM_ADMIN
  // default. The two mutations (regenerateDisplaySlugAction,
  // setAnnouncementRepeatCountAction) enforce owner-only independently,
  // inside each action — this route rule only ever governed the view.
  it("gates TV Display on plain DASHBOARD_ACCESS, not the /dashboard/admin parent's SYSTEM_ADMIN default", () => {
    expect(
      canAccessRoute("/dashboard/admin/tv-display", true, [PERMISSIONS.DASHBOARD_ACCESS]),
    ).toBe("allowed");
    expect(canAccessRoute("/dashboard/admin/tv-display", true, [])).toBe("forbidden");
  });
});

describe("requiresPasswordChangeRedirect", () => {
  it("does nothing when mustChangePassword is false", () => {
    expect(requiresPasswordChangeRedirect("/dashboard/bookings", false)).toBe(false);
    expect(requiresPasswordChangeRedirect(CHANGE_PASSWORD_PATH, false)).toBe(false);
  });

  it("redirects away from any other /dashboard path when mustChangePassword is true", () => {
    expect(requiresPasswordChangeRedirect("/dashboard/bookings", true)).toBe(true);
    expect(requiresPasswordChangeRedirect("/dashboard", true)).toBe(true);
  });

  it("allows the change-password page itself, and nested paths under it", () => {
    expect(requiresPasswordChangeRedirect(CHANGE_PASSWORD_PATH, true)).toBe(false);
    expect(requiresPasswordChangeRedirect(`${CHANGE_PASSWORD_PATH}/confirm`, true)).toBe(false);
  });
});
