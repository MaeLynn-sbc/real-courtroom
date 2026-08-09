/**
 * Owner request (2026-08-09): "an outside special court" — a second,
 * fully isolated open-play check-in board, temporary and simple. Refined
 * over several messages: check in, group up to 4 players and assign them
 * to one of 3 courts at once ("like i can form a group and put it to
 * court a"), mark a game done, repeat, and a manual "Announce" button
 * per court (watched by the isolated /specialtv-style display) — with
 * explicit requirements: no money ("its 0"), not in the regular Open
 * Play's player-tabs history, no TV/announce connection to the REAL
 * Open Play system.
 *
 * Proves, against real rows:
 *   1. checkIn creates a WAITING row.
 *   2. assignGroupToCourt claims a GROUP of players onto one court at
 *      once (WAITING -> PLAYING), stamping the court and startedAt.
 *   3. assignGroupToCourt rejects a group that would push a court over
 *      4 players — no silent over-booking.
 *   4. announceCourt stamps announcementRequestedAt on every current
 *      occupant of that court together.
 *   5. completeCourtGame frees the whole court and returns every
 *      occupant to WAITING ("mark a game done, repeat").
 *   6. checkOut removes a single player from the active board (DONE),
 *      freeing their seat without ending the rest of the group's game.
 *   7. listForDate excludes DONE check-ins — only WAITING/PLAYING show.
 *   8. The isolation guarantee itself: none of this ever creates a
 *      Sale, PlayerTab, GameAssignment, QueueEntry, or
 *      OpenPlayNightRegistration row — zero shared tables with the real
 *      Open Play system, by construction.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { specialOpenPlayService } from "./special-open-play.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_DATE = new Date(2031, 11, 26); // isolated, arbitrary date

async function cleanUp(): Promise<void> {
  await prisma.specialOpenPlayCheckIn.deleteMany({ where: { date: TEST_DATE } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUp();

  try {
    const [saleCountBefore, tabCountBefore, assignmentCountBefore, queueCountBefore, regCountBefore] =
      await Promise.all([
        prisma.sale.count(),
        prisma.playerTab.count(),
        prisma.gameAssignment.count(),
        prisma.queueEntry.count(),
        prisma.openPlayNightRegistration.count(),
      ]);

    // ============== 1. checkIn creates a WAITING row ==============
    const alice = await specialOpenPlayService.checkIn(
      TEST_DATE,
      { playerName: "Alice Special", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    const ben = await specialOpenPlayService.checkIn(TEST_DATE, { playerName: "Ben Special" }, owner.id);
    assert(alice.status === "WAITING", `expected WAITING, got ${alice.status}`);
    assert(alice.courtLabel === null, "expected no court assigned yet");
    console.log("PASS: checkIn creates real WAITING rows.");

    // ============== 2. assignGroupToCourt groups multiple players onto one court ==============
    await specialOpenPlayService.assignGroupToCourt([alice.id, ben.id], "Court 1");
    const board1 = await specialOpenPlayService.listForDate(TEST_DATE);
    const court1Occupants = board1.filter((c) => c.courtLabel === "Court 1");
    assert(court1Occupants.length === 2, `expected 2 players on Court 1, got ${court1Occupants.length}`);
    assert(
      court1Occupants.every((c) => c.status === "PLAYING" && c.startedAt !== null),
      "expected both grouped players to be PLAYING with startedAt stamped",
    );
    console.log("PASS: assignGroupToCourt groups multiple players onto one court at once.");

    // ============== 3. Rejects a group that would push a court over capacity ==============
    const dan = await specialOpenPlayService.checkIn(TEST_DATE, { playerName: "Dan Special" }, owner.id);
    const eve = await specialOpenPlayService.checkIn(TEST_DATE, { playerName: "Eve Special" }, owner.id);
    const finn = await specialOpenPlayService.checkIn(TEST_DATE, { playerName: "Finn Special" }, owner.id);
    let rejectedOverCapacity = false;
    try {
      // Court 1 already has 2 (Alice, Ben) — adding 3 more would be 5, over the cap of 4.
      await specialOpenPlayService.assignGroupToCourt([dan.id, eve.id, finn.id], "Court 1");
    } catch (error) {
      rejectedOverCapacity = true;
      assert(String(error).includes("room for"), `expected a capacity error, got ${error}`);
    }
    assert(rejectedOverCapacity, "expected a group exceeding the court's remaining capacity to be rejected");
    console.log("PASS: assignGroupToCourt rejects a group that would push a court over 4 players.");

    // A group of exactly 2 (fits the remaining 2 slots) succeeds.
    await specialOpenPlayService.assignGroupToCourt([dan.id, eve.id], "Court 1");
    const board2 = await specialOpenPlayService.listForDate(TEST_DATE);
    const court1Full = board2.filter((c) => c.courtLabel === "Court 1");
    assert(court1Full.length === 4, `expected Court 1 to now have 4 players, got ${court1Full.length}`);
    console.log("PASS: a group that exactly fills the remaining capacity succeeds.");

    // ============== 4. announceCourt stamps every occupant together ==============
    await specialOpenPlayService.announceCourt(TEST_DATE, "Court 1");
    const board3 = await specialOpenPlayService.listForDate(TEST_DATE);
    const court1Announced = board3.filter((c) => c.courtLabel === "Court 1");
    assert(
      court1Announced.every((c) => c.announcementRequestedAt !== null),
      "expected every Court 1 occupant to have announcementRequestedAt stamped",
    );
    console.log("PASS: announceCourt stamps announcementRequestedAt on every current occupant of the court.");

    // ============== 4b. announceTimesUp stamps every occupant together, separate token ==============
    await specialOpenPlayService.announceTimesUp(TEST_DATE, "Court 1");
    const board3b = await specialOpenPlayService.listForDate(TEST_DATE);
    const court1TimesUp = board3b.filter((c) => c.courtLabel === "Court 1");
    assert(
      court1TimesUp.every((c) => c.timesUpRequestedAt !== null),
      "expected every Court 1 occupant to have timesUpRequestedAt stamped",
    );
    console.log("PASS: announceTimesUp stamps timesUpRequestedAt on every current occupant of the court.");

    // ============== 5. completeCourtGame frees the whole court, back to WAITING ==============
    await specialOpenPlayService.completeCourtGame(TEST_DATE, "Court 1");
    const board4 = await specialOpenPlayService.listForDate(TEST_DATE);
    const stillOnCourt1 = board4.filter((c) => c.courtLabel === "Court 1");
    assert(stillOnCourt1.length === 0, "expected Court 1 to be completely freed");
    const backToWaiting = board4.filter((c) => [alice.id, ben.id, dan.id, eve.id].includes(c.id));
    assert(
      backToWaiting.every((c) => c.status === "WAITING"),
      "expected every former Court 1 occupant to be back in Waiting",
    );
    console.log("PASS: completeCourtGame frees the whole court and returns every occupant to Waiting.");

    // ============== 6. checkOut removes a single player without ending the group's game ==============
    await specialOpenPlayService.assignGroupToCourt([alice.id, ben.id], "Court 2");
    const checkedOut = await specialOpenPlayService.checkOut(alice.id);
    assert(checkedOut.status === "DONE", `expected DONE, got ${checkedOut.status}`);
    const board5 = await specialOpenPlayService.listForDate(TEST_DATE);
    const benRow = board5.find((c) => c.id === ben.id);
    assert(
      benRow?.status === "PLAYING" && benRow.courtLabel === "Court 2",
      "expected Ben to still be PLAYING on Court 2 after Alice alone checked out",
    );
    console.log("PASS: checkOut removes one player without ending the rest of the group's game.");

    // ============== 7. listForDate excludes DONE check-ins ==============
    assert(
      !board5.some((c) => c.id === checkedOut.id),
      "expected the checked-out player to be excluded from the board",
    );
    console.log("PASS: listForDate shows active (WAITING/PLAYING) check-ins only, excluding DONE.");

    // ============== 8. Zero footprint in every real Open Play / money table ==============
    const [saleCountAfter, tabCountAfter, assignmentCountAfter, queueCountAfter, regCountAfter] =
      await Promise.all([
        prisma.sale.count(),
        prisma.playerTab.count(),
        prisma.gameAssignment.count(),
        prisma.queueEntry.count(),
        prisma.openPlayNightRegistration.count(),
      ]);
    assert(saleCountAfter === saleCountBefore, "expected zero Sale rows created by Special Open Play");
    assert(tabCountAfter === tabCountBefore, "expected zero PlayerTab rows created by Special Open Play");
    assert(
      assignmentCountAfter === assignmentCountBefore,
      "expected zero GameAssignment rows created by Special Open Play",
    );
    assert(
      queueCountAfter === queueCountBefore,
      "expected zero QueueEntry rows created by Special Open Play",
    );
    assert(
      regCountAfter === regCountBefore,
      "expected zero OpenPlayNightRegistration rows created by Special Open Play",
    );
    console.log(
      "PASS: zero footprint in Sale, PlayerTab, GameAssignment, QueueEntry, or OpenPlayNightRegistration — fully isolated.",
    );

    await cleanUp();
    console.log("\nPASS: Special Open Play proven against real rows — grouping, announce, isolated, no money.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
