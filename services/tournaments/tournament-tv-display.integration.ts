/**
 * Owner request (2026-08-09): a TV display for tournaments (/tourtv),
 * auto-calling doubles matches to a court the moment staff assign one —
 * same concept as Open Play's TV, for Match instead of GameAssignment.
 * Widened 2026-08-15: every not-yet-finished match now shows somewhere
 * (grouped into a real per-court queue, or a courtId, or an "unscheduled"
 * bucket if there's no court assigned yet), not just a single match per
 * court.
 *
 * Proves, against real rows:
 *   1. scheduleMatch stamps a real, non-null announcementRequestedAt the
 *      instant a court is assigned — no separate "Announce" step exists
 *      for tournaments; assigning the court IS the trigger.
 *   2. Re-scheduling (even to the same court) bumps it again, to a
 *      fresh, later timestamp — freely re-triggerable, same shape as
 *      Open Play's manual re-announce.
 *   2b. scheduleMatch({ courtId: null }) actually clears the court
 *      (Prisma treats undefined as "leave unchanged," not null — a
 *      real live bug, "reassign again to court 1 it doesnt go thru"),
 *      the court frees up in getDisplayData afterward, and reassigning
 *      to a court after clearing works cleanly.
 *   3. tournamentDisplayService.getDisplayData() surfaces a court-
 *      assigned, non-bye, SCHEDULED/IN_PROGRESS match with full (not
 *      abbreviated) team names on both sides, under its court. Owner
 *      request (2026-08-15): "i want u to maximize the space so u can
 *      input all the complete names" — full names, overriding the
 *      general public-display "First L." shortening convention for
 *      this screen specifically (see tournament-display.service.ts's
 *      own comment on shortDisplayName).
 *   4. A match with NO court assigned appears in `unscheduled`, not
 *      dropped — and a second match on the SAME court queues behind the
 *      first, in order, instead of replacing it.
 *   5. A bye (team2Id null) is excluded even if it somehow has a court.
 *   6. A COMPLETED match is excluded even though it still has a court.
 *   7. stageMatch (owner request, 2026-08-15: manual Scoresheet staging
 *      into Next up/After that/Then) puts a match in `staged`, clears
 *      any real court, never appears under a court group or in
 *      `unscheduled`; assigning a real court afterwards clears
 *      stagedSlot back out; `staged` is always ordered NEXT_UP, then
 *      AFTER_THAT, then THEN regardless of creation order.
 *   8. When no match anywhere is currently visible (a lull between
 *      rounds), tournamentName/tournamentLogoUrl fall back to the sole
 *      "live" Tournament (any status except DRAFT/COMPLETED/CANCELLED)
 *      instead of going blank — confirmed against REGISTRATION_OPEN
 *      specifically, since that's the real status production's actual
 *      tournament sat at the whole time the owner reported this bug.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { matchService } from "./match.service";
import { tournamentService } from "./tournament.service";
import { tournamentDisplayService } from "../display/tournament-display.service";
import type { TournamentDisplayData } from "../display/tournament-display.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function findInFeed(data: TournamentDisplayData, matchId: string) {
  for (const court of data.courts) {
    const found = court.matches.find((m) => m.id === matchId);
    if (found) return found;
  }
  return data.unscheduled.find((m) => m.id === matchId);
}

function existsInFeed(data: TournamentDisplayData, matchId: string): boolean {
  return findInFeed(data, matchId) !== undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cleanUp(tournamentId: string | null): Promise<void> {
  if (!tournamentId) return;
  const categories = await prisma.tournamentCategory.findMany({
    where: { tournamentId },
    select: { id: true },
  });
  for (const category of categories) {
    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: category.id },
      select: { id: true, teamId: true, team: { select: { player1Id: true, player2Id: true } } },
    });
    const teamIds = registrations.map((r) => r.teamId);
    const playerIds = registrations.flatMap((r) =>
      r.team.player2Id ? [r.team.player1Id, r.team.player2Id] : [r.team.player1Id],
    );
    await prisma.match.deleteMany({ where: { tournamentCategoryId: category.id } });
    await prisma.tournamentRegistration.deleteMany({
      where: { id: { in: registrations.map((r) => r.id) } },
    });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    const players = await prisma.player.findMany({ where: { id: { in: playerIds } }, select: { userId: true } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: players.map((p) => p.userId) } } });
  }
  await prisma.tournamentCategory.deleteMany({ where: { tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2, orderBy: { name: "asc" } });
  assert(courts.length >= 2, "expected at least two active courts as fixtures");
  const [courtA, courtB] = courts;
  const suffix = Date.now();

  let tournamentId: string | null = null;
  try {
    const tournament = await tournamentService.createTournament(
      {
        name: `TourTV Test Tournament ${suffix}`,
        startDate: new Date(2031, 9, 10),
        endDate: new Date(2031, 9, 11),
        collectsPaymentOnSite: false,
      },
      owner.id,
    );
    tournamentId = tournament.id;

    const category = await tournamentService.createCategory(
      tournament.id,
      { name: "TourTV Doubles", format: "ROUND_ROBIN", division: "OPEN" },
      owner.id,
    );

    const reg1 = await tournamentService.registerTeam(
      category.id,
      { player1Name: `Mae Tanaka${suffix}`, player2Name: `Jane Cruz${suffix}` },
      owner.id,
      null,
    );
    const reg2 = await tournamentService.registerTeam(
      category.id,
      { player1Name: `John Alba${suffix}`, player2Name: `Ben Bautista${suffix}` },
      owner.id,
      null,
    );

    const match = await prisma.match.create({
      data: {
        tournamentCategoryId: category.id,
        team1Id: reg1.teamId,
        team2Id: reg2.teamId,
        status: "SCHEDULED",
      },
    });

    // ============== 1. Auto-fires on court assignment ==============
    const scheduled = await matchService.scheduleMatch(match.id, { courtId: courtA.id }, owner.id);
    assert(
      scheduled.announcementRequestedAt !== null,
      "expected announcementRequestedAt to be stamped the instant a court is assigned",
    );
    const firstAnnouncedAt = scheduled.announcementRequestedAt!.getTime();
    console.log("PASS: scheduleMatch auto-fires the announcement the instant a court is assigned.");

    // ============== 2. Re-scheduling bumps it again ==============
    await sleep(10);
    const rescheduled = await matchService.scheduleMatch(match.id, { courtId: courtB.id }, owner.id);
    assert(
      rescheduled.announcementRequestedAt !== null &&
        rescheduled.announcementRequestedAt.getTime() > firstAnnouncedAt,
      "expected re-scheduling to bump announcementRequestedAt forward, freely re-triggerable",
    );
    console.log("PASS: re-scheduling (even to a different court) re-announces with a fresh timestamp.");

    // ============== 2b. Clearing a court with courtId: null actually clears it ==============
    // Owner report (2026-08-15), LIVE during the tournament: "if i put
    // the team to no court from court 1 and then reassign again to
    // court 1 it doesnt go thru... court 1 is not available for other
    // teams" — root cause was the Scoresheet's "No court" option
    // sending courtId: undefined, which Prisma treats as "leave
    // unchanged," not "clear it." Proves the real fix: courtId: null
    // (now accepted by scheduleMatchSchema) actually nulls the column,
    // and the court genuinely frees up for another match afterward.
    const clearedFromCourt = await matchService.scheduleMatch(match.id, { courtId: null }, owner.id);
    assert(
      clearedFromCourt.courtId === null,
      `expected courtId: null to actually clear the court, got ${clearedFromCourt.courtId}`,
    );
    const afterClearing = await tournamentDisplayService.getDisplayData();
    const courtBAfterClearing = afterClearing.courts.find((court) => court.courtName === courtB.name);
    assert(
      courtBAfterClearing && courtBAfterClearing.matches.length === 0,
      `expected ${courtB.name} to have zero matches after clearing, got ${courtBAfterClearing?.matches.length}`,
    );
    console.log("PASS: scheduleMatch with courtId: null actually clears the court, freeing it up for other matches.");

    // Reassigning to a court afterward (the second half of the reported
    // bug: "reassign again to court 1 it doesnt go thru") works cleanly
    // once the field was genuinely cleared.
    const reassigned = await matchService.scheduleMatch(match.id, { courtId: courtB.id }, owner.id);
    assert(
      reassigned.courtId === courtB.id,
      `expected reassigning to ${courtB.name} after clearing to succeed, got courtId=${reassigned.courtId}`,
    );
    console.log("PASS: reassigning to a court after clearing it works correctly.");

    // ============== 3. Surfaces correctly in the display feed ==============
    const displayed = await tournamentDisplayService.getDisplayData();
    const displayedMatch = findInFeed(displayed, match.id);
    assert(displayedMatch, "expected the court-assigned match to appear in tournamentDisplayService.getDisplayData()");
    assert(
      displayedMatch!.courtName === courtB.name,
      `expected courtName to be the most recently assigned court (${courtB.name}), got ${displayedMatch!.courtName}`,
    );
    assert(
      displayedMatch!.team1.names.join(",") === `Mae Tanaka${suffix},Jane Cruz${suffix}`,
      `expected team1 names shown in full, got ${displayedMatch!.team1.names.join(",")}`,
    );
    assert(
      displayedMatch!.team2.names.join(",") === `John Alba${suffix},Ben Bautista${suffix}`,
      `expected team2 names shown in full, got ${displayedMatch!.team2.names.join(",")}`,
    );
    console.log("PASS: the match surfaces in the display feed with full (non-abbreviated) team names on both sides.");

    // ============== 3b. Team numbers ("1a"/"2a") surface too ==============
    // Set directly, not via setTeamPool — that service method correctly
    // refuses once a match exists for the category (this test creates
    // Match rows by hand, not via generateBracket), a real guard not
    // being tested here.
    await prisma.tournamentRegistration.update({
      where: { tournamentCategoryId_teamId: { tournamentCategoryId: category.id, teamId: reg1.teamId } },
      data: { poolLabel: "A", poolPosition: 1 },
    });
    await prisma.tournamentRegistration.update({
      where: { tournamentCategoryId_teamId: { tournamentCategoryId: category.id, teamId: reg2.teamId } },
      data: { poolLabel: "A", poolPosition: 2 },
    });
    const displayedWithPools = await tournamentDisplayService.getDisplayData();
    const matchWithPools = findInFeed(displayedWithPools, match.id);
    assert(matchWithPools, "expected the match to still appear after pool assignment");
    assert(
      matchWithPools!.team1.number === "1a",
      `expected team1's number to be "1a" (first team assigned to pool A), got ${matchWithPools!.team1.number}`,
    );
    assert(
      matchWithPools!.team2.number === "2a",
      `expected team2's number to be "2a" (second team assigned to pool A), got ${matchWithPools!.team2.number}`,
    );
    console.log("PASS: getDisplayData surfaces each team's real pool number (\"1a\"/\"2a\"), scoped by category.");

    // ============== 4. No court assigned — appears in `unscheduled` ==============
    const unassignedMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: reg2.teamId, status: "SCHEDULED" },
    });
    const afterUnassigned = await tournamentDisplayService.getDisplayData();
    assert(
      afterUnassigned.unscheduled.some((m) => m.id === unassignedMatch.id),
      "expected a match with no court assigned to appear in the unscheduled bucket, not be dropped",
    );
    assert(
      !afterUnassigned.courts.some((court) => court.matches.some((m) => m.id === unassignedMatch.id)),
      "expected an unscheduled match to never appear under a court group",
    );
    console.log("PASS: a match with no court assigned appears in the unscheduled bucket, not dropped.");

    // ============== 4b. A second match on the SAME court queues behind the first ==============
    const queuedMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: reg2.teamId, status: "SCHEDULED" },
    });
    await matchService.scheduleMatch(queuedMatch.id, { courtId: courtB.id }, owner.id);
    const afterQueued = await tournamentDisplayService.getDisplayData();
    const courtBGroup = afterQueued.courts.find((court) => court.courtName === courtB.name);
    assert(courtBGroup, `expected a court group for ${courtB.name}`);
    assert(
      courtBGroup!.matches.length === 2,
      `expected 2 matches queued on ${courtB.name} (the original + this one), got ${courtBGroup!.matches.length}`,
    );
    assert(
      courtBGroup!.matches[0].id === match.id && courtBGroup!.matches[1].id === queuedMatch.id,
      "expected the original match to stay first in the queue, the newly-scheduled one queued behind it",
    );
    console.log("PASS: a second match scheduled to the same court queues behind the first, in order.");

    // ============== 4c. Manual staging (Next up/After that/Then) ==============
    const thenMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: reg2.teamId, status: "SCHEDULED" },
    });
    const nextUpMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: reg2.teamId, status: "SCHEDULED" },
    });
    // Staged out of order (THEN first, NEXT_UP second) to prove the
    // returned `staged` array orders by slot, not by staging order.
    await matchService.stageMatch(thenMatch.id, "THEN", owner.id);
    const stagedNextUp = await matchService.stageMatch(nextUpMatch.id, "NEXT_UP", owner.id);
    assert(stagedNextUp.courtId === null, "expected stageMatch to clear any real court assignment");

    const afterStaging = await tournamentDisplayService.getDisplayData();
    assert(
      afterStaging.staged.length === 2 &&
        afterStaging.staged[0].id === nextUpMatch.id &&
        afterStaging.staged[1].id === thenMatch.id,
      "expected `staged` to contain both matches, ordered NEXT_UP before THEN regardless of staging order",
    );
    assert(
      !afterStaging.unscheduled.some((m) => m.id === nextUpMatch.id || m.id === thenMatch.id),
      "expected staged matches to never appear in the unscheduled bucket",
    );
    assert(
      !afterStaging.courts.some((court) => court.matches.some((m) => m.id === nextUpMatch.id)),
      "expected a staged match to never appear under a court group",
    );
    console.log("PASS: stageMatch stages a match into a real Next up/After that/Then slot, ordered correctly, excluded from unscheduled and every court group.");

    // Assigning a real court afterwards supersedes staging.
    const rescheduledFromStaging = await matchService.scheduleMatch(
      nextUpMatch.id,
      { courtId: courtA.id },
      owner.id,
    );
    assert(
      rescheduledFromStaging.stagedSlot === null,
      "expected assigning a real court to clear stagedSlot back out",
    );
    const afterRescheduling = await tournamentDisplayService.getDisplayData();
    assert(
      !afterRescheduling.staged.some((m) => m.id === nextUpMatch.id),
      "expected the now-court-assigned match to leave the staged list",
    );
    console.log("PASS: assigning a real court to a staged match clears stagedSlot and moves it out of `staged`.");

    // Regression (reported live 2026-08-17): "when u choose and u select
    // to no court it's still on then, next up and all." Picking "No
    // court" on a STAGED match must take it off the board entirely —
    // scheduleMatch used to test input.courtId for truthiness, so an
    // explicit null cleared the court but silently left stagedSlot set,
    // stranding the match in Next up / After that / Then with no way out.
    const stagedThenCleared = await matchService.stageMatch(thenMatch.id, "AFTER_THAT", owner.id);
    assert(
      stagedThenCleared.stagedSlot === "AFTER_THAT",
      "fixture check: expected the match to be staged before clearing it",
    );
    const clearedToNoCourt = await matchService.scheduleMatch(
      thenMatch.id,
      { courtId: null },
      owner.id,
    );
    assert(
      clearedToNoCourt.courtId === null,
      "expected 'No court' to clear the court assignment",
    );
    assert(
      clearedToNoCourt.stagedSlot === null,
      "expected 'No court' to ALSO clear the staging slot — a match taken off the board must not stay in Next up/After that/Then",
    );
    const afterNoCourt = await tournamentDisplayService.getDisplayData();
    assert(
      !afterNoCourt.staged.some((m) => m.id === thenMatch.id),
      "expected a match set to 'No court' to disappear from the staged list on the TV display",
    );
    console.log("PASS: 'No court' clears the staging slot too — the match leaves Next up/After that/Then.");

    // The other direction must NOT change: an update that never mentions
    // the court (scheduledAt only) leaves staging exactly as it was.
    const restaged = await matchService.stageMatch(thenMatch.id, "THEN", owner.id);
    assert(restaged.stagedSlot === "THEN", "fixture check: expected the match to be staged again");
    const timeOnlyUpdate = await matchService.scheduleMatch(
      thenMatch.id,
      { scheduledAt: new Date() },
      owner.id,
    );
    assert(
      timeOnlyUpdate.stagedSlot === "THEN",
      "expected an update that doesn't mention the court to leave the staging slot untouched",
    );
    console.log("PASS: an update with no court field leaves staging alone — only an explicit court/No-court changes it.");

    // ============== 5. A bye (team2Id null) is excluded even with a court ==============
    const byeMatch = await prisma.match.create({
      data: { tournamentCategoryId: category.id, team1Id: reg1.teamId, team2Id: null, courtId: courtA.id, status: "SCHEDULED" },
    });
    const afterBye = await tournamentDisplayService.getDisplayData();
    assert(
      !existsInFeed(afterBye, byeMatch.id),
      "expected a bye (no opposing team) to be excluded even with a court assigned",
    );
    console.log("PASS: a bye with no opposing team is excluded even with a court assigned.");

    // ============== 6. A COMPLETED match is excluded even with a court ==============
    const completedMatch = await prisma.match.create({
      data: {
        tournamentCategoryId: category.id,
        team1Id: reg1.teamId,
        team2Id: reg2.teamId,
        courtId: courtA.id,
        status: "COMPLETED",
        announcementRequestedAt: new Date(),
      },
    });
    const afterCompleted = await tournamentDisplayService.getDisplayData();
    assert(
      !existsInFeed(afterCompleted, completedMatch.id),
      "expected a COMPLETED match to be excluded even though it still has a court assigned",
    );
    console.log("PASS: a COMPLETED match is excluded even though it still has a court assigned.");

    // ============== 8. Logo/name fallback during a match-less lull ==============
    // Owner report (2026-08-15): "the sayans and friends logo and the
    // text... is gone" — during a genuine lull (no match anywhere is
    // currently SCHEDULED/IN_PROGRESS), getDisplayData falls back to
    // whichever Tournament is itself "live" (not DRAFT/COMPLETED/
    // CANCELLED), so the header doesn't blank out just because nothing's
    // actively on court right now. Uses REGISTRATION_OPEN specifically —
    // that's the real status production's tournament was sitting at when
    // this bug was reported live, confirming the fallback isn't narrowly
    // scoped to only IN_PROGRESS. Deletes every match this fixture
    // created so it contributes nothing to the feed, then only asserts
    // the fallback fired when the system-wide feed happens to be
    // genuinely empty (skips, rather than flaking, if some other
    // tournament's match is active in the dev DB at the same time this
    // runs).
    await prisma.match.deleteMany({ where: { tournamentCategoryId: category.id } });
    await prisma.tournament.update({ where: { id: tournament.id }, data: { status: "REGISTRATION_OPEN" } });
    const duringLull = await tournamentDisplayService.getDisplayData();
    const feedIsGloballyEmpty =
      duringLull.courts.every((court) => court.matches.length === 0) &&
      duringLull.staged.length === 0 &&
      duringLull.unscheduled.length === 0;
    if (feedIsGloballyEmpty) {
      assert(
        duringLull.tournamentName === tournament.name,
        `expected the sole live tournament's name as a fallback when no matches are visible, got ${duringLull.tournamentName}`,
      );
      console.log("PASS: falls back to the sole live (REGISTRATION_OPEN) tournament's name/logo when no matches are currently visible.");
    } else {
      console.log(
        "SKIP: another match is active elsewhere in the dev DB right now, can't deterministically prove the zero-match fallback this run.",
      );
    }

    await cleanUp(tournamentId);
    console.log("\nPASS: tournament TV display (/tourtv) proven against real rows.");
  } catch (error) {
    await cleanUp(tournamentId);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
