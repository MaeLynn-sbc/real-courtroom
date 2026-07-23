// Whether the public website advertises a section — a different question
// from lib/module-flags.ts's "can staff create one internally" (an Owner
// may keep Tournament registration open to staff without yet advertising
// it publicly). Same Setting-table mechanism, same absent-row-means-off
// default, deliberately a separate key namespace.
export const PUBLIC_VISIBILITY_KEYS = {
  OPEN_PLAY: "public.open_play.visible",
  TOURNAMENTS: "public.tournaments.visible",
  MEMBERSHIP: "public.membership.visible",
  PRODUCTS: "public.products.visible",
} as const;

export type PublicVisibilityKey =
  (typeof PUBLIC_VISIBILITY_KEYS)[keyof typeof PUBLIC_VISIBILITY_KEYS];

export type PublicVisibilityFlags = Record<PublicVisibilityKey, boolean>;
