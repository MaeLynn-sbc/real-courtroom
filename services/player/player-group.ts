import type { Prisma } from "@/lib/generated/prisma/client";

// Tournament players vs. our open-play regulars (owner, 2026-09-17:
// "most tournament players don't come back anymore"). Derived from what
// a player has actually done, never stored, so it can't go stale: a
// tournament entrant who later shows up for open play, books a court,
// takes a coach or buys a membership becomes a regular on their own.
//
//  - "tournament": has played a tournament and done nothing else here.
//  - "regulars":   everyone else (including profiles made by hand that
//                  have no activity yet).
//  - "all":        no filter.
export type PlayerGroup = "regulars" | "tournament" | "all";

export const PLAYER_GROUPS: PlayerGroup[] = ["regulars", "tournament", "all"];

const TOURNAMENT_ONLY: Prisma.PlayerWhereInput = {
  OR: [{ teamsAsPlayer1: { some: {} } }, { teamsAsPlayer2: { some: {} } }],
  openPlayNightRegistrations: { none: {} },
  openPlayRegistrations: { none: {} },
  bookings: { none: {} },
  coachSessions: { none: {} },
  memberships: { none: {} },
};

export function playerGroupWhere(group: PlayerGroup): Prisma.PlayerWhereInput {
  if (group === "tournament") return TOURNAMENT_ONLY;
  if (group === "regulars") return { NOT: TOURNAMENT_ONLY };
  return {};
}
