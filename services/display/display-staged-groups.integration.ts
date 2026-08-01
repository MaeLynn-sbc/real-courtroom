/**
 * Reported live: the TV display and /phone showed Next up/After that/Then
 * boxes with real-looking names even though nothing was actually staged —
 * both clients independently chunked the leftover Waiting queue into
 * groups of 4 (the OLD, pre-staging-groups preview behavior), completely
 * disconnected from the REAL staged groups the admin Rotation Board now
 * shows. Fixed by having displayService.getDisplayData expose the same
 * real rotationBoard.stagedGroups the admin board reads, instead of the
 * client re-deriving a fake one from `queue`.
 *
 * Proves, against real rows:
 *   1. A staged group shows up in DisplayData.stagedGroups with the
 *      correct (pre-shortened) names, keyed by the right slot.
 *   2. Staged players are excluded from DisplayData.queue entirely — no
 *      overlap between the two, unlike the old chunked-preview behavior.
 *   3. An empty slot (nothing staged) is simply ABSENT from stagedGroups
 *      — never a fake entry borrowed from the front of Waiting.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { computeBusinessDate } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { displayService } from "./display.service";
import { openPlayCheckinService } from "../open-play/open-play-checkin.service";
import { openPlayRegistrationService } from "../open-play/open-play-registration.service";
import { openPlayRotationService } from "../open-play/open-play-rotation.service";
import { settingsService } from "../settings/settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function checkedInRegistration(
  date: Date,
  playerName: string,
  actorUserId: string,
): Promise<string> {
  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    {
      playerName,
      phone: `09${Date.now()}${Math.random()}`.replace(/\D/g, "").slice(0, 11),
      skillLevel: "INTERMEDIATE",
    },
    actorUserId,
  );
  await openPlayCheckinService.checkIn(registration.id, actorUserId);
  return registration.id;
}

async function cleanUp(registrationIds: string[], date: Date): Promise<void> {
  await prisma.auditLog.deleteMany({
    where: { entityType: { in: ["StagedGroup", "QueueEntry"] } },
  });
  await prisma.tabLineItem.deleteMany({
    where: { tab: { registrationId: { in: registrationIds } } },
  });
  await prisma.playerTab.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.queueEntry.deleteMany({ where: { registrationId: { in: registrationIds } } });
  await prisma.stagedGroup.deleteMany({ where: { date } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: registrationIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  // Exactly the same computation getDisplayData itself uses internally
  // (it always reads the current business date, no date param to pass) —
  // avoids any drift risk if this happens to run near the rollover hour.
  const courtHours = await settingsService.getCourtHours();
  const date = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const allRegistrationIds: string[] = [];

  try {
    // Deliberately distinct, non-prefix-colliding first tokens (unlike
    // e.g. "Display Staged Alice" / "Display Waiting Carla", which would
    // both start with "Display" and defeat a prefix-based assertion) —
    // shortDisplayName's "initial" format is "First L.", so the first
    // token alone is enough to tell these three apart unambiguously.
    const stagedAliceId = await checkedInRegistration(date, "Zstagedalice One", owner.id);
    const stagedBenId = await checkedInRegistration(date, "Zstagedben Two", owner.id);
    allRegistrationIds.push(stagedAliceId, stagedBenId);
    await openPlayRotationService.stageManualGroup(
      date,
      "NEXT_UP",
      [stagedAliceId, stagedBenId],
      owner.id,
    );

    const waitingOnlyId = await checkedInRegistration(date, "Zwaitingcarla Three", owner.id);
    allRegistrationIds.push(waitingOnlyId);

    const data = await displayService.getDisplayData();

    // ============== 1. Real staged group shows up, correctly keyed ==============
    const nextUp = data.stagedGroups.find((g) => g.slot === "NEXT_UP");
    assert(nextUp, "expected a NEXT_UP entry in DisplayData.stagedGroups");
    assert(
      nextUp!.names.some((n) => n.startsWith("Zstagedalice")) &&
        nextUp!.names.some((n) => n.startsWith("Zstagedben")),
      `expected the staged group's names to include both staged players, got: ${nextUp!.names.join(", ")}`,
    );
    assert(
      nextUp!.names.length === 2,
      `expected exactly 2 staged names, got ${nextUp!.names.length}`,
    );
    console.log(
      "PASS: a real staged group shows up in DisplayData.stagedGroups, correctly keyed by slot.",
    );

    // ============== 2. Staged players are excluded from DisplayData.queue ==============
    const queueHasStagedName = data.queue.some(
      (name) => name.startsWith("Zstagedalice") || name.startsWith("Zstagedben"),
    );
    assert(
      !queueHasStagedName,
      "expected staged players to be absent from DisplayData.queue entirely",
    );
    const queueHasWaitingName = data.queue.some((name) => name.startsWith("Zwaitingcarla"));
    assert(
      queueHasWaitingName,
      "expected the genuinely-waiting player to still show up in DisplayData.queue",
    );
    console.log(
      "PASS: staged players are excluded from DisplayData.queue — no overlap with the staged-groups boxes.",
    );

    // ============== 3. An empty slot is absent, not a fake borrowed entry ==============
    const afterThat = data.stagedGroups.find((g) => g.slot === "AFTER_THAT");
    const then = data.stagedGroups.find((g) => g.slot === "THEN");
    assert(
      afterThat === undefined,
      "expected AFTER_THAT to be absent from stagedGroups — nothing was staged there",
    );
    assert(
      then === undefined,
      "expected THEN to be absent from stagedGroups — nothing was staged there",
    );
    console.log(
      "PASS: an empty slot is simply absent from stagedGroups, never a fake entry borrowed from Waiting.",
    );

    console.log("\nPASS: display staged-groups fix proven against real rows.");
  } finally {
    await cleanUp(allRegistrationIds, date);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
