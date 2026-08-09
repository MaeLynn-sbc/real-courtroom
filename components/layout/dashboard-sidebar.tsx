"use client";

import {
  Activity,
  BarChart3,
  Banknote,
  CalendarDays,
  Clock,
  CreditCard,
  Dumbbell,
  FileText,
  Globe,
  GraduationCap,
  History,
  Landmark,
  LayoutDashboard,
  Lock,
  MapPin,
  Megaphone,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingBag,
  TrendingDown,
  Trophy,
  Tv,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/components/shared/logo";
import { dashboardNavGroups, dashboardNavItems } from "@/lib/config";
import { isFridayOrSaturday } from "@/lib/court-hours";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, typeof LayoutDashboard> = {
  "/dashboard": LayoutDashboard,
  "/dashboard/shift": Clock,
  "/dashboard/courts": MapPin,
  "/dashboard/bookings": CalendarDays,
  "/dashboard/bookings/verify-payments": Receipt,
  "/dashboard/admin/open-play-capacity/verify-payments": Banknote,
  "/dashboard/coaching": GraduationCap,
  "/dashboard/tournaments": Trophy,
  "/dashboard/players": Users,
  "/dashboard/memberships": CreditCard,
  "/dashboard/equipment": Dumbbell,
  "/dashboard/lockers": Lock,
  "/dashboard/products": ShoppingBag,
  "/dashboard/reports": FileText,
  "/dashboard/analytics": BarChart3,
  "/dashboard/announcements": Megaphone,
  "/dashboard/admin/employees": UserCog,
  "/dashboard/admin/roles": ShieldCheck,
  "/dashboard/admin/payment-methods": Wallet,
  "/dashboard/admin/expenses": TrendingDown,
  "/dashboard/admin/products": ShoppingBag,
  "/dashboard/admin/website": Globe,
  "/dashboard/admin/audit-logs": History,
  "/dashboard/admin/settings": Settings,
  "/dashboard/admin/diagnostics": Activity,
  "/dashboard/admin/gcash-reconciliation": Landmark,
  "/dashboard/admin/openplayspecial": Tv,
};

// Owner request (2026-08-09): "visible only to me" — the one deliberate
// exception to this file's own "not visually permission-filtered" rule
// below. A private, temporary, isolated check-in board for the outside
// special court (see SpecialOpenPlayCheckIn's own schema comment), not
// meant to appear in every staff member's nav. Kept OUT of
// lib/config.ts's dashboardNavGroups (which every item below still
// reads from, unfiltered) so it can't leak into that shared, always-
// rendered list — conditionally appended to the Administration group
// below instead, based on a permission check threaded in from
// app/dashboard/layout.tsx (the same SYSTEM_ADMIN check that page's own
// route access already requires — see lib/rbac.ts's /dashboard/admin
// default).
const OPEN_PLAY_SPECIAL_ITEM = { title: "Special Open Play", href: "/dashboard/admin/openplayspecial" };

// Picks the longest href that matches the current path (exact or as a
// parent segment), so a nested route like /dashboard/courts/abc123
// highlights "Courts" without also highlighting "Dashboard".
function getActiveHref(pathname: string, hrefs: readonly string[]): string | undefined {
  const matches = hrefs.filter((href) => pathname === href || pathname.startsWith(`${href}/`));

  if (matches.length === 0) {
    return undefined;
  }

  return matches.reduce((longest, href) => (href.length > longest.length ? href : longest));
}

const OPEN_PLAY_CAPACITY_PREFIX = "/dashboard/admin/open-play-capacity";
const FRI_SAT_OPEN_PLAY_HREF = "/dashboard/admin/open-play-capacity";
const WEEKNIGHT_OPEN_PLAY_HREF = "/dashboard/admin/open-play-capacity/today";
const DATE_SEGMENT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// "Weeknight Open Play" and "Fri/Sat Open Play" both resolve to the
// same dynamic [date] route once a date is picked — Weeknight only
// gets there via /today's own server-side redirect to today's date
// (app/dashboard/admin/open-play-capacity/today/page.tsx). Reported
// live: getActiveHref's plain prefix match can't tell the two apart
// from the URL alone, so it always picked Fri/Sat's shorter, always-
// matching prefix, even on a weeknight date — landing on the correct
// page with the wrong sidebar item highlighted.
//
// Fixed by deciding from the date itself, not from which href happens
// to prefix-match: a dated capacity page (.../2026-07-30) resolves to
// whichever nav entry actually corresponds to that date's real
// weekday, via the same Fri/Sat rule court-hours.ts already used
// privately. This also covers navigating between days from inside the
// page itself (the date picker, not just the two sidebar links) — any
// date this route can show resolves correctly, not just the one
// /today redirects to today. Returns undefined for the bare list page
// (no date segment) and for verify-payments (not a date), letting
// getActiveHref's normal matching handle both exactly as before.
function resolveOpenPlayCapacityActiveHref(pathname: string): string | undefined {
  if (!pathname.startsWith(`${OPEN_PLAY_CAPACITY_PREFIX}/`)) {
    return undefined;
  }

  const dateSegment = pathname.slice(`${OPEN_PLAY_CAPACITY_PREFIX}/`.length);
  if (!DATE_SEGMENT_PATTERN.test(dateSegment)) {
    return undefined;
  }

  // Local-midnight parse (not a bare "YYYY-MM-DD", which JS parses as
  // UTC and can land on the wrong weekday depending on the browser's
  // offset) — same discipline this app's other date-only parsing uses.
  const date = new Date(`${dateSegment}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return isFridayOrSaturday(date) ? FRI_SAT_OPEN_PLAY_HREF : WEEKNIGHT_OPEN_PLAY_HREF;
}

// This list is NOT visually permission-filtered — every signed-in staff
// member sees the same full nav regardless of role, same as it's always
// been for every entry here (Roles, Audit Logs, Employees, ...).
// Real access control lives at the route level (lib/rbac.ts's
// canAccessRoute, enforced by middleware.ts), which every one of these
// hrefs is already registered against — Coaching included
// (BOOKINGS_MANAGE). Clicking a link you can't use lands on that route's
// own access-denied handling, not a broken/missing page. Hiding items
// per-role would need session/permission data threaded into this client
// component, which doesn't happen anywhere else in this file today —
// out of scope for adding one more link.
export function DashboardSidebar({
  canViewOpenPlaySpecial = false,
}: {
  // Owner-only ("visible only to me") — see OPEN_PLAY_SPECIAL_ITEM's own
  // comment. Defaults false so every other existing call site (there are
  // none today, but a default keeps this a non-breaking prop addition)
  // stays exactly as it was.
  canViewOpenPlaySpecial?: boolean;
}) {
  const pathname = usePathname();
  const allHrefs = canViewOpenPlaySpecial
    ? [...dashboardNavItems.map((item) => item.href), OPEN_PLAY_SPECIAL_ITEM.href]
    : dashboardNavItems.map((item) => item.href);
  const activeHref = resolveOpenPlayCapacityActiveHref(pathname) ?? getActiveHref(pathname, allHrefs);

  return (
    <aside className="border-border/60 bg-sidebar text-sidebar-foreground hidden w-56 shrink-0 border-r md:flex md:flex-col md:overflow-y-auto">
      <div className="border-sidebar-border/60 flex h-16 items-center border-b px-4">
        <Link href="/dashboard" className="flex items-center">
          <Logo size="sm" showWordmark />
        </Link>
      </div>
      <nav className="flex flex-col gap-4 p-3">
        {dashboardNavGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <h2 className="text-sidebar-foreground/60 px-3 pb-1 text-xs font-semibold tracking-wide uppercase">
              {group.label}
            </h2>
            {(group.label === "Administration" && canViewOpenPlaySpecial
              ? [...group.items, OPEN_PLAY_SPECIAL_ITEM]
              : group.items
            ).map((item) => {
              const Icon = NAV_ICONS[item.href];
              const isActive = item.href === activeHref;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                  )}
                >
                  {Icon ? <Icon className="size-4" aria-hidden="true" /> : null}
                  {item.title}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
