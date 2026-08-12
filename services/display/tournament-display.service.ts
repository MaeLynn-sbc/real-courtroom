import { prisma } from "@/lib/prisma";
import { formatTeamPoolNumber } from "@/services/tournaments/bracket-generator";

// Owner request (2026-08-09): a TV display for tournaments (/tourtv),
// same concept as the Open Play TV (services/display/display.service.ts)
// but for doubles matches instead of open-play foursomes. Deliberately a
// SEPARATE service/file, not a mode on displayService — the underlying
// data (Match, not GameAssignment/Booking) and shape (two teams, not a
// player list) are different enough that sharing one function would mean
// threading a discriminated branch through nearly every line. Small
// formatting helpers below are duplicated from display.service.ts rather
// than imported, same "small per-service formatting, not cross-imported"
// precedent already used throughout this codebase.

export interface TournamentDisplayTeam {
  // 1 name (singles) or 2 (doubles) — "First L." shortened, same
  // BUILD-SPEC.md §12 "no full names on a public display" rule the Open
  // Play TV already follows.
  names: string[];
  // Owner request (2026-08-12): "can the team has numbers. like what
  // number they are in the pool or bracket" — "1a"/"2a" style (services/
  // tournaments/bracket-generator.ts's formatTeamPoolNumber). Null for
  // an unassigned team or a match from a non-pooled category.
  number: string | null;
}

export interface TournamentDisplayMatch {
  id: string;
  courtName: string;
  team1: TournamentDisplayTeam;
  team2: TournamentDisplayTeam;
  categoryLabel: string;
  status: "SCHEDULED" | "IN_PROGRESS";
  // Null until a court has ever been assigned — the TV watches this
  // value (paired with the match id) to decide when to (re-)speak, not
  // the courtId/status itself. See Match.announcementRequestedAt's own
  // schema comment.
  announcementRequestedAt: string | null;
}

export interface TournamentDisplayData {
  generatedAt: string;
  matches: TournamentDisplayMatch[];
}

// Mirrors display.service.ts's shortDisplayName exactly (see that
// file's own comment) — "First L." only; this display has no /phone-
// style stricter-privacy variant to support, unlike Open Play's.
function shortDisplayName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) {
    return "Guest";
  }
  if (trimmed.includes("@")) {
    return trimmed.split("@")[0] || "Guest";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

type MatchTeam = {
  player1: { user: { name: string | null; email: string | null } };
  player2: { user: { name: string | null; email: string | null } } | null;
};

function toDisplayTeam(team: MatchTeam, number: string | null): TournamentDisplayTeam {
  const names = [shortDisplayName(team.player1.user.name ?? team.player1.user.email)];
  if (team.player2) {
    names.push(shortDisplayName(team.player2.user.name ?? team.player2.user.email));
  }
  return { names, number };
}

export class TournamentDisplayService {
  // Only matches with a real court assigned — court assignment is 100%
  // staff-driven (matchService.scheduleMatch, no auto-assignment exists),
  // so "has a courtId" already means "imminent/current," same as how
  // Open Play's board only shows what's actually been proposed to a
  // court. A bye (team2Id null — Single Elimination odd-team-count slot)
  // has nothing to display against, so it's excluded outright, not shown
  // half-empty.
  async getDisplayData(): Promise<TournamentDisplayData> {
    const matches = await prisma.match.findMany({
      where: {
        courtId: { not: null },
        team2Id: { not: null },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      },
      include: {
        court: true,
        team1: {
          include: {
            player1: { include: { user: { select: { name: true, email: true } } } },
            player2: { include: { user: { select: { name: true, email: true } } } },
          },
        },
        team2: {
          include: {
            player1: { include: { user: { select: { name: true, email: true } } } },
            player2: { include: { user: { select: { name: true, email: true } } } },
          },
        },
        tournamentCategory: { include: { tournament: { select: { name: true } } } },
      },
      // IN_PROGRESS first (already on court, most relevant), then
      // SCHEDULED ordered by whenever they were assigned — scheduledAt
      // can be null (staff can assign a court without a specific time,
      // since matches are typically walk-up-and-assign on the day), so
      // fall back to the assignment moment itself.
      orderBy: [{ status: "asc" }, { scheduledAt: "asc" }, { announcementRequestedAt: "asc" }],
    });

    const filtered = matches.filter(
      (match): match is typeof match & { team2: NonNullable<typeof match.team2> } => Boolean(match.team2),
    );

    // Owner request (2026-08-12): team numbers — a Match has no direct
    // link to a registration (same reason Match.poolLabel is itself
    // denormalized, see that field's own schema comment), so each
    // team's poolLabel/poolPosition is looked up here, scoped by
    // (categoryId, teamId) since the same team could theoretically be
    // registered under different categories across the facility-wide
    // set of matches this display spans.
    const registrations = await prisma.tournamentRegistration.findMany({
      where: {
        teamId: { in: [...new Set(filtered.flatMap((match) => [match.team1Id, match.team2Id as string]))] },
      },
      select: { teamId: true, tournamentCategoryId: true, poolLabel: true, poolPosition: true },
    });
    const numberByCategoryAndTeam = new Map<string, string | null>();
    for (const registration of registrations) {
      numberByCategoryAndTeam.set(
        `${registration.tournamentCategoryId}:${registration.teamId}`,
        formatTeamPoolNumber(registration.poolLabel, registration.poolPosition),
      );
    }

    return {
      generatedAt: new Date().toISOString(),
      matches: filtered.map((match) => ({
        id: match.id,
        courtName: match.court?.name ?? "Court",
        team1: toDisplayTeam(
          match.team1,
          numberByCategoryAndTeam.get(`${match.tournamentCategoryId}:${match.team1Id}`) ?? null,
        ),
        team2: toDisplayTeam(
          match.team2,
          numberByCategoryAndTeam.get(`${match.tournamentCategoryId}:${match.team2Id}`) ?? null,
        ),
        categoryLabel: match.tournamentCategory
          ? `${match.tournamentCategory.tournament.name} — ${match.tournamentCategory.name}`
          : "Tournament",
        status: match.status === "IN_PROGRESS" ? "IN_PROGRESS" : "SCHEDULED",
        announcementRequestedAt: match.announcementRequestedAt?.toISOString() ?? null,
      })),
    };
  }
}

export const tournamentDisplayService = new TournamentDisplayService();
