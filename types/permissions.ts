// Permission keys used by seeded RolePermission grants and by lib/rbac.ts
// route checks. New permissions are added here and in prisma/seed.ts — the
// database rows are what actually govern access at runtime.

export const PERMISSIONS = {
  DASHBOARD_ACCESS: "dashboard:access",
  SYSTEM_ADMIN: "system:admin",
  USERS_MANAGE: "users:manage",
  COURTS_MANAGE: "courts:manage",
  BOOKINGS_MANAGE: "bookings:manage",
  OPEN_PLAY_MANAGE: "open_play:manage",
  TOURNAMENTS_MANAGE: "tournaments:manage",
  PLAYERS_MANAGE: "players:manage",
  EQUIPMENT_MANAGE: "equipment:manage",
  REPORTS_MANAGE: "reports:manage",
  // v1.2 DRAFT (coaching sessions, Gate 1): a coach edits ONLY their own
  // availability windows — this permission gates "can reach the
  // endpoint at all," the service layer enforces the actual employeeId
  // match, same shape as every other "own X" scoping in this codebase.
  COACHING_MANAGE_OWN_AVAILABILITY: "coaching:manage_own_availability",
  // Rate-table edits (group size -> price, per coach) — owner-tier,
  // matching the existing precedent that CMS/rates-adjacent settings
  // gate on SYSTEM_ADMIN, not a narrower permission.
  COACHING_MANAGE_RATES: "coaching:manage_rates",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
