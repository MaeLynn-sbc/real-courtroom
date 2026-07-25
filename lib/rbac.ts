import { PERMISSIONS, type PermissionKey } from "@/types/permissions";

interface RouteRule {
  prefix: string;
  permission: PermissionKey;
}

// Route-prefix -> required-permission config. This is the mechanism future
// phases plug into as new protected sections are added — permissions
// themselves are database-configurable (see prisma/seed.ts), only the
// mapping of a URL prefix to a required permission key lives in code.
const PROTECTED_ROUTES: RouteRule[] = [
  { prefix: "/dashboard", permission: PERMISSIONS.DASHBOARD_ACCESS },
  { prefix: "/dashboard/courts/new", permission: PERMISSIONS.COURTS_MANAGE },
  { prefix: "/dashboard/bookings", permission: PERMISSIONS.BOOKINGS_MANAGE },
  { prefix: "/dashboard/open-play", permission: PERMISSIONS.OPEN_PLAY_MANAGE },
  { prefix: "/dashboard/tournaments", permission: PERMISSIONS.TOURNAMENTS_MANAGE },
  { prefix: "/dashboard/players", permission: PERMISSIONS.PLAYERS_MANAGE },
  { prefix: "/dashboard/memberships", permission: PERMISSIONS.PLAYERS_MANAGE },
  { prefix: "/dashboard/equipment", permission: PERMISSIONS.EQUIPMENT_MANAGE },
  { prefix: "/dashboard/lockers", permission: PERMISSIONS.EQUIPMENT_MANAGE },
  { prefix: "/dashboard/products", permission: PERMISSIONS.EQUIPMENT_MANAGE },
  { prefix: "/dashboard/reports", permission: PERMISSIONS.REPORTS_MANAGE },
  { prefix: "/dashboard/analytics", permission: PERMISSIONS.REPORTS_MANAGE },
  { prefix: "/dashboard/sales", permission: PERMISSIONS.REPORTS_MANAGE },
  { prefix: "/dashboard/announcements/new", permission: PERMISSIONS.SYSTEM_ADMIN },
  { prefix: "/dashboard/admin", permission: PERMISSIONS.SYSTEM_ADMIN },
  // v1.1: Employee/Role management is Owner-only (USERS_MANAGE), a
  // stricter rule than the /dashboard/admin parent's SYSTEM_ADMIN default
  // — longest-prefix-match means these two override it, everything else
  // under /dashboard/admin (Audit Logs, Settings, Diagnostics) inherits
  // SYSTEM_ADMIN as before.
  { prefix: "/dashboard/admin/employees", permission: PERMISSIONS.USERS_MANAGE },
  { prefix: "/dashboard/admin/roles", permission: PERMISSIONS.USERS_MANAGE },
];

export type RouteAccessDecision = "allowed" | "unauthenticated" | "forbidden";

// v1.2: the only page a must-change-password account may reach under
// /dashboard. Logout needs no special-casing here — signOut() posts to
// an /api/auth/* route, outside middleware's /dashboard/:path* matcher.
export const CHANGE_PASSWORD_PATH = "/dashboard/change-password";

// Checked BEFORE canAccessRoute's permission logic (see middleware.ts) —
// a must-change account is blocked from everything under /dashboard
// regardless of what permissions its role would otherwise grant, until it
// changes its password. Kept as its own pure function (not folded into
// canAccessRoute) because it's a different kind of decision: permission-
// independent, and applies even to paths canAccessRoute would otherwise
// mark "allowed" (e.g. the /dashboard root itself).
export function requiresPasswordChangeRedirect(pathname: string, mustChangePassword: boolean): boolean {
  return mustChangePassword && !pathname.startsWith(CHANGE_PASSWORD_PATH);
}

// Picks the longest (most specific) matching prefix rather than the first
// match in array order, so nested rules like /dashboard/courts/new can
// require a stricter permission than their /dashboard parent regardless of
// where they're declared in PROTECTED_ROUTES.
function matchRoute(pathname: string): RouteRule | undefined {
  const matches = PROTECTED_ROUTES.filter((rule) => pathname.startsWith(rule.prefix));

  if (matches.length === 0) {
    return undefined;
  }

  return matches.reduce((longest, rule) =>
    rule.prefix.length > longest.prefix.length ? rule : longest,
  );
}

export function hasPermission(permissions: string[], permission: PermissionKey): boolean {
  return permissions.includes(permission);
}

export function canAccessRoute(
  pathname: string,
  isAuthenticated: boolean,
  permissions: string[],
): RouteAccessDecision {
  const rule = matchRoute(pathname);

  if (!rule) {
    return "allowed";
  }

  if (!isAuthenticated) {
    return "unauthenticated";
  }

  return hasPermission(permissions, rule.permission) ? "allowed" : "forbidden";
}
