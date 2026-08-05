// The fixed set of system role keys, mirrored into the Role table by
// prisma/seed.ts. This exists only for seeding and type-narrowing — the
// database (Role/RolePermission) is always the source of truth for which
// permissions a role actually grants.

// MANAGER and RECEPTIONIST were removed 2026-08-05 — unused built-in
// defaults (0 users in production) superseded by owner-managed custom
// roles created through the Roles screen (e.g. "Court Attendant",
// "Coach" — role.service.ts's createRole, isSystem: false). Those aren't
// listed here: this constant is only for the fixed system defaults
// seed.ts creates with isSystem: true and blocks deletion of; a custom
// role is deliberately NOT part of it.
export const SYSTEM_ROLES = {
  OWNER: "OWNER",
  // v1.1: labeled "Tournament Staff" in the seed/UI — the stable key stays
  // TOURNAMENT_DIRECTOR since renaming it would touch permission-wiring
  // code paths, only the seeded label changed.
  TOURNAMENT_DIRECTOR: "TOURNAMENT_DIRECTOR",
  MEMBER: "MEMBER",
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

// Guest is an unauthenticated user — it has no Role row in the database.
export const GUEST_ROLE = "GUEST" as const;

export type AppRole = SystemRoleName | typeof GUEST_ROLE;
