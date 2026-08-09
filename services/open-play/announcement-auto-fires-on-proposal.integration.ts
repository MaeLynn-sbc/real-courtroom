/**
 * Owner request (2026-08-09): "i want the regular open play to be
 * automatic but dont remove the button to announce the names." Until
 * now, announcementRequestedAt started null at proposal — the TV never
 * spoke until a staffer pressed "Announce" at least once (a deliberate
 * design choice, see the old comment on createAssignmentTx/
 * announceAssignment in open-play-rotation.service.ts). Reversed: the
 * first announcement now fires automatically the instant a foursome is
 * proposed to a court, through createAssignmentTx — the single choke
 * point every assignment-creation path (auto-pairing, manual staff
 * assignment, staged-group promotion) already funnels through. The
 * manual "Announce" button (announceAssignment) is unchanged and stays
 * fully re-pressable, for re-announcing.
 *
 * Proves, against real rows:
 *   1. createManualAssignment (one of the createAssignmentTx callers)
 *      stamps a real, non-null announcementRequestedAt immediately —
 *      no button press needed.
 *   2. The manual "Announce" button still works afterward: pressing it
 *      moves the timestamp forward to a fresh, later value (a genuine
 *      re-announce), proving it wasn't disabled or made a no-op by the
 *      auto-fire.
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const TEST_DATE = new Date(2031, 11, 2); // isolated open-play "night" date

async function cleanUp(registrationIds: string[]): Promise<void> {
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.gameAssignment.deleteMany({ where: { date: TEST_DATE } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: registrationIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null, status: "ACTIVE" } });

  const registrationIds: string[] = [];
  try {
    for (let i = 0; i < 4; i++) {
      const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
        TEST_DATE,
        { playerName: `Auto Announce Test ${i}`, phone: `0917000090${i}`, skillLevel: "INTERMEDIATE" },
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

    // 1. Auto-fires on proposal — no button press.
    const assignment = await openPlayRotationService.createManualAssignment(
      TEST_DATE,
      court.id,
      registrationIds,
      owner.id,
    );
    assert(
      assignment.announcementRequestedAt !== null,
      "expected announcementRequestedAt to be stamped automatically the instant the assignment is proposed",
    );
    const firstAnnouncedAt = assignment.announcementRequestedAt!.getTime();
    console.log("PASS: the first announcement fires automatically at proposal — no staff button press needed.");

    // 2. The manual Announce button still works — a fresh, later timestamp.
    await sleep(10);
    const reAnnounced = await openPlayRotationService.announceAssignment(assignment.id, owner.id);
    assert(
      reAnnounced.announcementRequestedAt !== null &&
        reAnnounced.announcementRequestedAt.getTime() > firstAnnouncedAt,
      "expected the manual Announce button to still move announcementRequestedAt forward to a fresh, later timestamp",
    );
    console.log("PASS: the manual Announce button still works for re-announcing — unaffected by the auto-fire.");

    await cleanUp(registrationIds);
    console.log(
      "\nPASS: Open Play now auto-announces on proposal, and the manual re-announce button is untouched.",
    );
  } catch (error) {
    await cleanUp(registrationIds);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
