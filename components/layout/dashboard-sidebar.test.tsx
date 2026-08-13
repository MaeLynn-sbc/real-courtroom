import { render, screen } from "@testing-library/react";

import { DashboardSidebar } from "./dashboard-sidebar";

jest.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// The sidebar now renders a profile footer (UserNav + useCurrentUser),
// which transitively imports next-auth/react — an ESM package jest's
// default transform can't parse from node_modules. Stubbed the same way
// any client component that reaches next-auth needs to be under this
// project's jest config (no transformIgnorePatterns override for it).
// No user session in this suite, so the footer simply doesn't render —
// none of these tests assert on it.
jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated", update: jest.fn() }),
  signOut: jest.fn(),
}));

// Owner request (2026-08-09): "visible only to me" — the one deliberate
// exception to this file's own documented "not visually permission-
// filtered" rule (every other nav item shows to every signed-in staff
// member regardless of role). Proves the exception actually holds both
// ways: hidden by default, shown only when the caller (app/dashboard/
// layout.tsx) passes the SYSTEM_ADMIN check through.
describe("DashboardSidebar — Special Open Play is owner-only", () => {
  it("hides 'Special Open Play' when canViewOpenPlaySpecial is false (the default)", () => {
    render(<DashboardSidebar />);
    expect(screen.queryByRole("link", { name: /special open play/i })).not.toBeInTheDocument();
  });

  it("shows 'Special Open Play', linking to the private page, when canViewOpenPlaySpecial is true", () => {
    render(<DashboardSidebar canViewOpenPlaySpecial />);
    const link = screen.getByRole("link", { name: /special open play/i });
    expect(link).toHaveAttribute("href", "/dashboard/admin/openplayspecial");
  });
});
