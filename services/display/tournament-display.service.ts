import type { StagedGroupSlot } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { courtService } from "@/services/court/court.service";
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
  // Null for a match in `unscheduled` below — no court to name yet.
  courtName: string | null;
  team1: TournamentDisplayTeam;
  team2: TournamentDisplayTeam;
  categoryLabel: string;
  status: "SCHEDULED" | "IN_PROGRESS";
  // Null until a court has ever been assigned — the TV watches this
  // value (paired with the match id) to decide when to (re-)speak, not
  // the courtId/status itself. See Match.announcementRequestedAt's own
  // schema comment.
  announcementRequestedAt: string | null;
  // Owner request (2026-08-15): staff manually stages a match into a
  // holding pen from the Scoresheet dropdown, ahead of assigning it a
  // real court — see Match.stagedSlot's own schema comment. Null for
  // every match on a real court or still fully unscheduled.
  stagedSlot: StagedGroupSlot | null;
}

export interface TournamentDisplayCourt {
  courtName: string;
  // [0] is playing now (IN_PROGRESS) or up first (earliest SCHEDULED) on
  // this court; anything after it is queued behind — "the next teams who
  // would play" (owner request, 2026-08-15), not just a single match per
  // court like before.
  matches: TournamentDisplayMatch[];
}

export interface TournamentDisplayData {
  generatedAt: string;
  courts: TournamentDisplayCourt[];
  // Every match that hasn't been assigned a court yet — owner request
  // (2026-08-15): "i want every match to be shown in /tourtv," not just
  // the ones already on a court. Excludes staged matches (see `staged`
  // below) — a match is either staged or truly unscheduled, never both.
  unscheduled: TournamentDisplayMatch[];
  // Owner request (2026-08-15): "add also in the dropdown the next up
  // after that and then... no voice announcements for next up after
  // that and then" — matches staff manually staged from the Scoresheet,
  // one array entry per staged match, in NEXT_UP/AFTER_THAT/THEN order.
  // NextUpRow reads this directly instead of auto-deriving overflow from
  // each court's own queue, now that staging is an explicit staff action.
  staged: TournamentDisplayMatch[];
  // Owner request (2026-08-15): "use their logo" — the organizer's own
  // branding (Tournament.logoUrl), shown alongside The Courtroom's own
  // logo in the header, emphasized. Null whenever this feed spans
  // matches from more than one tournament (or none) — showing one
  // tournament's logo while displaying another's matches would be
  // actively misleading, so this only ever resolves when every match on
  // screen belongs to the exact same tournament.
  tournamentName: string | null;
  tournamentLogoUrl: string | null;
}

// Owner request (2026-08-15): "i want u to maximize the space so u can
// input all the complete names" — full names now, not the "First L."
// shortened form display.service.ts's own shortDisplayName still uses
// (see that file's own comment on the general public-display privacy
// convention) — the owner explicitly wants full names on THIS screen
// specifically, for THIS tournament's own audience, overriding that
// default here only.
function shortDisplayName(fullName: string | null | undefined): string {
  const trimmed = (fullName ?? "").trim();
  if (!trimmed) {
    return "Guest";
  }
  if (trimmed.includes("@")) {
    return trimmed.split("@")[0] || "Guest";
  }
  return trimmed;
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
  // Every not-yet-finished match with a real opponent — widened
  // 2026-08-15 from "only matches with a court assigned" (owner request:
  // "i want every match to be shown," plus a real per-court queue, not
  // just whichever single match happens to be on court right now). A
  // bye (team2Id null — Single Elimination odd-team-count slot) has
  // nothing to display against, so it's still excluded outright, not
  // shown half-empty; COMPLETED/CANCELLED/WALKOVER stay excluded too —
  // nothing left to queue or announce for those.
  async getDisplayData(): Promise<TournamentDisplayData> {
    const activeCourts = await courtService.listCourts();
    const matches = await prisma.match.findMany({
      where: {
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
        tournamentCategory: { include: { tournament: { select: { id: true, name: true, logoUrl: true } } } },
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

    const toDisplayMatch = (match: (typeof filtered)[number]): TournamentDisplayMatch => ({
      id: match.id,
      courtName: match.court?.name ?? null,
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
      stagedSlot: match.stagedSlot,
    });

    // Grouped by court, not one flat list — "queue in every court the
    // next teams who would play" (owner request, 2026-08-15). The SQL
    // ORDER BY above (status, then scheduledAt, then
    // announcementRequestedAt) already puts each court's own matches in
    // the right queue order as they're encountered here, so no re-sort
    // is needed within a group.
    //
    // Seeded with EVERY real, active court up front (owner report,
    // 2026-08-15, live on the real screen: "where are the steady boxes
    // for courts 1 2 and 3" — a court with nothing assigned yet used to
    // not appear at all, since it was only ever added to this map when
    // a match referenced it). Matches an empty court to "no games
    // assigned," same as /tv's own AVAILABLE state for a court with no
    // bookings — the box itself is always there.
    const courtsByName = new Map<string, TournamentDisplayMatch[]>(
      activeCourts.map((court) => [court.name, []]),
    );
    const unscheduled: TournamentDisplayMatch[] = [];
    const staged: TournamentDisplayMatch[] = [];
    for (const match of filtered) {
      const displayMatch = toDisplayMatch(match);
      if (match.court) {
        const existing = courtsByName.get(match.court.name);
        if (existing) {
          existing.push(displayMatch);
        } else {
          courtsByName.set(match.court.name, [displayMatch]);
        }
      } else if (match.stagedSlot) {
        staged.push(displayMatch);
      } else {
        unscheduled.push(displayMatch);
      }
    }
    const stagedSlotOrder: Record<StagedGroupSlot, number> = { NEXT_UP: 0, AFTER_THAT: 1, THEN: 2 };
    staged.sort((a, b) => stagedSlotOrder[a.stagedSlot!] - stagedSlotOrder[b.stagedSlot!]);

    const courts: TournamentDisplayCourt[] = Array.from(courtsByName.entries())
      .map(([courtName, courtMatches]) => ({ courtName, matches: courtMatches }))
      .sort((a, b) => a.courtName.localeCompare(b.courtName));

    const distinctTournaments = new Map(
      filtered
        .map((match) => match.tournamentCategory?.tournament)
        .filter((tournament): tournament is NonNullable<typeof tournament> => Boolean(tournament))
        .map((tournament) => [tournament.id, tournament]),
    );
    let soleTournament = distinctTournaments.size === 1 ? [...distinctTournaments.values()][0] : null;

    // Owner report (2026-08-15): "the sayans and friends logo and the
    // text... is gone" — happens during a genuine lull with zero
    // matches currently SCHEDULED/IN_PROGRESS anywhere (e.g. between
    // rounds, before the next round's matches exist yet), so there's no
    // match at all to derive a tournament from. Falls back to whichever
    // Tournament is itself marked IN_PROGRESS — only resolved when
    // there's exactly one, same "don't guess when ambiguous" precedent
    // as the match-derived path above (more than one IN_PROGRESS
    // tournament stays null, same as more than one distinct tournament
    // in the match feed already does).
    if (!soleTournament && distinctTournaments.size === 0) {
      const inProgressTournaments = await prisma.tournament.findMany({
        where: { status: "IN_PROGRESS" },
        select: { id: true, name: true, logoUrl: true },
      });
      if (inProgressTournaments.length === 1) {
        soleTournament = inProgressTournaments[0];
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      courts,
      unscheduled,
      staged,
      tournamentName: soleTournament?.name ?? null,
      tournamentLogoUrl: soleTournament?.logoUrl ?? null,
    };
  }
}

export const tournamentDisplayService = new TournamentDisplayService();
