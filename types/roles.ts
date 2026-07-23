// The fixed set of system role keys, mirrored into the Role table by
// prisma/seed.ts. This exists only for seeding and type-narrowing — the
// database (Role/RolePermission) is always the source of truth for which
// permissions a role actually grants.

export const SYSTEM_ROLES = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  RECEPTIONIST: "RECEPTIONIST",
  // v1.1: labeled "Tournament Staff" in the seed/UI — the stable key stays
  // TOURNAMENT_DIRECTOR since renaming it would touch permission-wiring
  // code paths, only the seeded label changed.
  TOURNAMENT_DIRECTOR: "TOURNAMENT_DIRECTOR",
  // v1.1: new — no cafe module exists yet, DASHBOARD_ACCESS only for now.
  CAFE_STAFF: "CAFE_STAFF",
  MEMBER: "MEMBER",
} as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

// Guest is an unauthenticated user — it has no Role row in the database.
export const GUEST_ROLE = "GUEST" as const;

export type AppRole = SystemRoleName | typeof GUEST_ROLE;
