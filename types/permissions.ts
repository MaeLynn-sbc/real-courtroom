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
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
