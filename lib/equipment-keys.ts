// Stable identifiers for Equipment rows the app looks up programmatically
// (see Equipment.key in prisma/schema.prisma) — same purpose and pattern
// as CMS_KEYS/PUBLIC_VISIBILITY_KEYS: renaming the seeded display name in
// the admin UI must never break a lookup that goes through one of these.
export const EQUIPMENT_KEYS = {
  HOUSE_PADDLE: "house_paddle",
} as const;
