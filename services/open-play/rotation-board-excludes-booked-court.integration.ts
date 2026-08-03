/**
 * Reported live: staff could still Propose/Quick-queue open-play players
 * onto a court reserved for a real court booking right now — "Idle" on
 * the rotation board only ever meant "no open-play game on it," it never
 * checked the separate booking system.
 *
 * Proves, against real rows:
 *   1. getRotationBoardData reports booked: true for a court with a real
 *      Booking overlapping this exact instant.
 *   2. createManualAssignment (the shared choke point every assignment-
 *      creation path funnels through — proposeNextAssignment and the
 *      staging pipeline's assignPendingGroupToCourt included) rejects an
 *      attempt to assign an open-play group to that booked court.
 *   3. The exact same players assign successfully to a DIFFERENT, free
 *      court — proving the rejection is specific to the booked court,
 *      not a blanket failure.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "../booking/booking.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const TEST_DATE = new Date(2031, 11, 1); // open-play "night" date — arbitrary, unrelated to the real booking's real-time overlap

async function cleanUp(bookingId: string | null, registrationIds: string[]): Promise<void> {
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: registrationIds } } });
  if (bookingId) {
    await prisma.bookingHistory.deleteMany({ where: { bookingId } });
    await prisma.booking.deleteMany({ where: { id: bookingId } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const courts = await prisma.court.findMany({ where: { deletedAt: null }, take: 2, orderBy: { name: "asc" } });
  assert(courts.length >= 2, "expected at least two active courts as fixtures");
  const [bookedCourt, freeCourt] = courts;

  // A real, currently-active booking — overlapping THIS exact instant,
  // not TEST_DATE (the rotation board's booked check only ever cares
  // about real wall-clock now, see RotationBoardCourt.booked's own
  // comment). Staff-created (bookingService.createBooking), not the
  // public path — the public path enforces real operating-hours
  // cutoffs, which would make this test fail depending on what time of
  // day it happens to run; that enforcement is deliberately staff-exempt
  // (see checkAvailabilityWithClient's own enforceOperatingHours flag).
  const now = new Date();
  const startAt = new Date(now.getTime() - 5 * 60 * 1000);
  const endAt = new Date(now.getTime() + 55 * 60 * 1000);
  const booking = await bookingService.createBooking(
    { courtId: bookedCourt.id, type: "HOURLY", startAt, endAt, guestName: "Rotation Board Booked-Court Guest" },
    owner.id,
    { employeeId: ownerEmployee.id, shiftId: undefined },
  );

  const registrationIds: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
        TEST_DATE,
        { playerName: `Booked Court Test ${i}`, phone: `0917000080${i}`, skillLevel: "INTERMEDIATE" },
        owner.id,
      );
      registrationIds.push(registration.id);
      await prisma.queueEntry.create({
        data: {
          registrationId: registration.id,
          sessionId: null,
          date: TEST_DATE,
          playerName: registration.playerName,
          skillLevel: registration.skillLevel,
          joinedQueueAt: new Date(),
          status: "WAITING",
        },
      });
    }

    // 1. The board reports the booked court as booked.
    const board = await openPlayRotationService.getRotationBoardData(TEST_DATE);
    const boardBookedCourt = board.courts.find((c) => c.court.id === bookedCourt.id);
    assert(boardBookedCourt !== undefined, "expected the booked court to appear on the board");
    assert(
      boardBookedCourt!.booked === true,
      "expected getRotationBoardData to report booked: true for a court with a real, currently-active booking",
    );
    console.log("PASS: getRotationBoardData reports booked: true for a court with a real, active booking.");

    // 2. Assigning to the booked court is rejected.
    let rejectedAsBooked = false;
    try {
      await openPlayRotationService.createManualAssignment(
        TEST_DATE,
        bookedCourt.id,
        registrationIds,
        owner.id,
      );
    } catch (error) {
      rejectedAsBooked = error instanceof Error && error.message.includes("currently booked");
    }
    assert(rejectedAsBooked, "expected assigning an open-play group to a booked court to be rejected");
    console.log("PASS: createManualAssignment rejects assigning a group to a court that's currently booked.");

    // 3. The same players assign fine to a different, free court.
    const assignment = await openPlayRotationService.createManualAssignment(
      TEST_DATE,
      freeCourt.id,
      registrationIds,
      owner.id,
    );
    assert(
      assignment.courtId === freeCourt.id,
      "expected the same group to assign successfully to a different, free court",
    );
    console.log("PASS: the same group assigns successfully to a different, free court — the rejection is specific to the booked court.");

    await cleanUp(booking.id, registrationIds);
  } catch (error) {
    await cleanUp(booking.id, registrationIds);
    throw error;
  }

  console.log(
    "\nPASS: a court reserved for a real booking right now is excluded from open-play assignment, proven against real rows.",
  );
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
