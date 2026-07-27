// No server-only imports (e.g. lib/env.ts) here — this file is imported by
// client components (dashboard-header.tsx, dashboard-sidebar.tsx), and
// bundling env validation into the browser crashes on load since
// process.env is empty client-side.
export const siteConfig = {
  name: "The Courtroom",
  shortName: "TCPMS",
  description:
    "Court management, scheduling, and operations for The Courtroom indoor pickleball facility.",
} as const;

export interface DashboardNavItem {
  title: string;
  href: string;
}

interface DashboardNavGroup {
  label: string;
  items: DashboardNavItem[];
}

// v1.1: grouped by how staff actually work, not by module — Operations is
// what reception touches every day and is listed first; Administration is
// setup/management screens. See ARCHITECTURE.md's v1.1 Sub-phase 1
// addendum for the full reasoning.
// No entry here for /dashboard/open-play — that's the old, dormant
// OpenPlaySession/OpenPlayQueue system (see prisma/schema.prisma's own
// comment above those models). The route and its underlying code are
// untouched and still reachable directly; only the nav link is gone, so
// staff can't land on it and think something's broken. The live system
// is /dashboard/admin/open-play-capacity, below.
export const dashboardNavGroups: DashboardNavGroup[] = [
  {
    label: "Operations",
    items: [
      { title: "Dashboard", href: "/dashboard" },
      { title: "Shift", href: "/dashboard/shift" },
      { title: "Bookings", href: "/dashboard/bookings" },
      { title: "Verify Payments", href: "/dashboard/bookings/verify-payments" },
      { title: "Verify Open Play Payments", href: "/dashboard/admin/open-play-capacity/verify-payments" },
      { title: "Equipment", href: "/dashboard/equipment" },
      { title: "Lockers", href: "/dashboard/lockers" },
      { title: "Products", href: "/dashboard/products" },
    ],
  },
  {
    label: "Tournaments",
    items: [
      { title: "Tournaments", href: "/dashboard/tournaments" },
      { title: "Players", href: "/dashboard/players" },
      { title: "Memberships", href: "/dashboard/memberships" },
    ],
  },
  {
    label: "Administration",
    items: [
      { title: "Courts", href: "/dashboard/courts" },
      { title: "Employees", href: "/dashboard/admin/employees" },
      { title: "Roles", href: "/dashboard/admin/roles" },
      { title: "Payment Methods", href: "/dashboard/admin/payment-methods" },
      { title: "Expenses", href: "/dashboard/admin/expenses" },
      { title: "Product Catalog", href: "/dashboard/admin/products" },
      { title: "Website", href: "/dashboard/admin/website" },
      // Renamed from "Open Play Capacity" — that read as Fri/Sat-only,
      // but this same screen also covers weeknight drop-in (its own
      // clearly labeled section on the page itself now, too).
      { title: "Open Play (Weeknight & Fri/Sat)", href: "/dashboard/admin/open-play-capacity" },
      { title: "Audit Logs", href: "/dashboard/admin/audit-logs" },
      { title: "Settings", href: "/dashboard/admin/settings" },
      { title: "Reports", href: "/dashboard/reports" },
      { title: "Sales", href: "/dashboard/sales" },
      { title: "Analytics", href: "/dashboard/analytics" },
      { title: "Announcements", href: "/dashboard/announcements" },
      { title: "Diagnostics", href: "/dashboard/admin/diagnostics" },
    ],
  },
];

// Flattened view — used anywhere that just needs every nav destination
// without caring about grouping (e.g. active-link matching).
export const dashboardNavItems: DashboardNavItem[] = dashboardNavGroups.flatMap((group) => group.items);
