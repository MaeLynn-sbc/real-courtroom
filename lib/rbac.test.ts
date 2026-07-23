import { canAccessRoute } from "@/lib/rbac";
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
});
