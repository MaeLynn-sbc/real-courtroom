/**
 * Manual "Time's up" call — twin of the assignment ANNOUNCE action, for
 * calling players off the court instead of onto it. Deliberately manual
 * (staff can see whether players noticed), re-pressable, ACTIVE-only.
 *
 * Proves, against real rows:
 *   1. Rejected on a PROPOSED (not yet started) assignment.
 *   2. Stamps timesUpRequestedAt on an ACTIVE assignment.
 *   3. Re-pressable — a second press stamps a fresh timestamp.
 *   4. Writes an audit log entry each time.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });

  const date = new Date();
  date.setDate(date.getDate() + ((2 - date.getDay() + 7) % 7 || 7));
  date.setHours(0, 0, 0, 0);

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    { playerName: "TimesUp Test", phone: "09171234567", skillLevel: "INTERMEDIATE" },
    owner.id,
  );

  const proposed = await prisma.gameAssignment.create({
    data: {
      courtId: court.id,
      date,
      skillSpread: 0,
      source: "MANUAL",
      status: "PROPOSED",
      participants: { create: [{ registrationId: registration.id }] },
    },
  });

  try {
    // ============== 1. Rejected on a PROPOSED assignment ==============
    let rejected = false;
    try {
      await openPlayRotationService.announceTimesUp(proposed.id, owner.id);
    } catch {
      rejected = true;
    }
    assert(rejected, "expected Time's up to be rejected on a PROPOSED assignment");
    console.log("PASS: rejected on a PROPOSED (not yet started) assignment.");

    // ============== 2. Stamps timesUpRequestedAt on ACTIVE ==============
    const active = await prisma.gameAssignment.update({
      where: { id: proposed.id },
      data: { status: "ACTIVE", startedAt: new Date() },
    });
    assert(active.timesUpRequestedAt === null, "expected timesUpRequestedAt to start null");

    const firstCall = await openPlayRotationService.announceTimesUp(proposed.id, owner.id);
    assert(firstCall.timesUpRequestedAt !== null, "expected timesUpRequestedAt to be stamped");
    console.log("PASS: stamps timesUpRequestedAt on an ACTIVE assignment.");

    // ============== 3. Re-pressable — a fresh timestamp each time ==============
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondCall = await openPlayRotationService.announceTimesUp(proposed.id, owner.id);
    assert(
      secondCall.timesUpRequestedAt!.getTime() > firstCall.timesUpRequestedAt!.getTime(),
      "expected a second press to stamp a fresh, later timestamp",
    );
    console.log("PASS: re-pressable — a second press stamps a fresh timestamp.");

    // ============== 4. Writes an audit log entry each time ==============
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entityType: "GameAssignment",
        entityId: proposed.id,
        action: "game_assignment.times_up_announced",
      },
    });
    assert(auditEntries.length === 2, `expected 2 audit entries, got ${auditEntries.length}`);
    console.log("PASS: writes an audit log entry each time.");

    console.log("\nPASS: manual Time's up call proven against real rows.");
  } finally {
    await prisma.auditLog.deleteMany({
      where: { entityType: "GameAssignment", entityId: proposed.id },
    });
    await prisma.gameAssignmentParticipant.deleteMany({ where: { assignmentId: proposed.id } });
    await prisma.gameAssignment.delete({ where: { id: proposed.id } });
    await prisma.openPlayNightRegistration.delete({ where: { id: registration.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
