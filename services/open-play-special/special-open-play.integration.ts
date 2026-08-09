/**
 * Owner request (2026-08-09): "an outside special court" — a second,
 * fully isolated open-play check-in board, temporary and simple (check
 * in, manually assign to one of 3 courts, mark a game done, repeat), with
 * explicit requirements: no money ("its 0"), not in the regular Open
 * Play's player-tabs history, no TV/announce connection.
 *
 * Proves, against real rows:
 *   1. checkIn creates a WAITING row.
 *   2. assignToCourt claims WAITING -> PLAYING, stamping the court and
 *      startedAt.
 *   3. assignToCourt rejects a court that's already occupied — no
 *      silent double-booking of the same court.
 *   4. completeGame frees the court and returns the player to WAITING
 *      ("mark a game done, repeat").
 *   5. checkOut removes a player from the active board (DONE), freeing
 *      their court if they were playing.
 *   6. listForDate excludes DONE check-ins — only WAITING/PLAYING show.
 *   7. The isolation guarantee itself: none of this ever creates a
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

const TEST_DATE = new Date(2031, 11, 25); // isolated, arbitrary date

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
    assert(alice.status === "WAITING", `expected WAITING, got ${alice.status}`);
    assert(alice.courtLabel === null, "expected no court assigned yet");
    console.log("PASS: checkIn creates a real WAITING row.");

    // ============== 2. assignToCourt claims WAITING -> PLAYING ==============
    const assigned = await specialOpenPlayService.assignToCourt(alice.id, "Court A");
    assert(assigned.status === "PLAYING", `expected PLAYING, got ${assigned.status}`);
    assert(assigned.courtLabel === "Court A", `expected Court A, got ${assigned.courtLabel}`);
    assert(assigned.startedAt !== null, "expected startedAt to be stamped");
    console.log("PASS: assignToCourt claims WAITING -> PLAYING and stamps the court.");

    // ============== 3. Rejects an already-occupied court ==============
    const bob = await specialOpenPlayService.checkIn(TEST_DATE, { playerName: "Bob Special" }, owner.id);
    let rejectedOccupied = false;
    try {
      await specialOpenPlayService.assignToCourt(bob.id, "Court A");
    } catch (error) {
      rejectedOccupied = true;
      assert(String(error).includes("already occupied"), `expected an already-occupied error, got ${error}`);
    }
    assert(rejectedOccupied, "expected assigning to an already-occupied court to be rejected");
    console.log("PASS: assignToCourt rejects a court that's already occupied — no double-booking.");

    // ============== 4. completeGame frees the court, back to WAITING ==============
    const completed = await specialOpenPlayService.completeGame(alice.id);
    assert(completed.status === "WAITING", `expected WAITING after completing, got ${completed.status}`);
    assert(completed.courtLabel === null, "expected the court to be freed");
    console.log("PASS: completeGame frees the court and returns the player to Waiting.");

    // Court A is free again — Bob can now take it.
    const bobAssigned = await specialOpenPlayService.assignToCourt(bob.id, "Court A");
    assert(bobAssigned.courtLabel === "Court A", "expected Court A to be assignable again once freed");
    console.log("PASS: a freed court can be assigned to someone else.");

    // ============== 5. checkOut removes a player, freeing their court ==============
    const checkedOut = await specialOpenPlayService.checkOut(bob.id);
    assert(checkedOut.status === "DONE", `expected DONE, got ${checkedOut.status}`);
    assert(checkedOut.courtLabel === null, "expected the court to be freed on checkout");
    console.log("PASS: checkOut removes the player (DONE) and frees their court.");

    // ============== 6. listForDate excludes DONE check-ins ==============
    const board = await specialOpenPlayService.listForDate(TEST_DATE);
    assert(
      board.some((c) => c.id === alice.id),
      "expected Alice (still WAITING) to appear on the board",
    );
    assert(
      !board.some((c) => c.id === bob.id),
      "expected Bob (DONE / checked out) to be excluded from the board",
    );
    console.log("PASS: listForDate shows active (WAITING/PLAYING) check-ins only, excluding DONE.");

    // ============== 7. Zero footprint in every real Open Play / money table ==============
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
    console.log("\nPASS: Special Open Play proven against real rows — isolated, no money, no shared tables.");
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
