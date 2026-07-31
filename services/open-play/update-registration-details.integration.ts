/**
 * Reported live: no way anywhere to fix a typo'd name or phone number on
 * an existing open-play registration short of cancelling and
 * re-registering — surfaced while building the "Next up" preview box's
 * Edit action.
 *
 * Proves, against a real row:
 *   1. Updating only the name leaves the phone untouched.
 *   2. Updating only the phone leaves the name untouched.
 *   3. Both writes are logged to the audit trail with correct old/new
 *      values.
 *   4. A name correction propagates to the denormalized playerName
 *      snapshot on QueueEntry (rotation board) and PlayerTab (billing)
 *      — reported live: editing was moved from the Rotation Board's
 *      "Next up" preview to the Player Tabs panel, where a stale tab
 *      name would be immediately, visibly wrong.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  // A plain Tuesday — regular (sessionId: null) open play, no Fri/Sat
  // capacity concerns relevant to this feature.
  const date = new Date();
  date.setDate(date.getDate() + ((2 - date.getDay() + 7) % 7 || 7));
  date.setHours(0, 0, 0, 0);

  const registration = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    { playerName: "Typo Namez", phone: "09170000000", skillLevel: "INTERMEDIATE" },
    owner.id,
  );

  try {
    // ============== 1. Updating only the name leaves the phone untouched ==============
    const afterNameFix = await openPlayRegistrationService.updateRegistrationDetails(
      registration.id,
      { playerName: "Typo Names" },
      owner.id,
    );
    assert(
      afterNameFix.playerName === "Typo Names",
      `expected corrected name, got ${afterNameFix.playerName}`,
    );
    assert(
      afterNameFix.phone === "09170000000",
      `expected phone unchanged, got ${afterNameFix.phone}`,
    );
    console.log("PASS: updating only the name leaves the phone untouched.");

    // ============== 2. Updating only the phone leaves the name untouched ==============
    const afterPhoneFix = await openPlayRegistrationService.updateRegistrationDetails(
      registration.id,
      { phone: "09179999999" },
      owner.id,
    );
    assert(
      afterPhoneFix.phone === "09179999999",
      `expected corrected phone, got ${afterPhoneFix.phone}`,
    );
    assert(
      afterPhoneFix.playerName === "Typo Names",
      `expected name unchanged, got ${afterPhoneFix.playerName}`,
    );
    console.log("PASS: updating only the phone leaves the name untouched.");

    // ============== 3. Both writes are logged to the audit trail with correct old/new values ==============
    const auditEntries = await prisma.auditLog.findMany({
      where: {
        entityType: "OpenPlayNightRegistration",
        entityId: registration.id,
        action: "open_play_night_registration.details_updated",
      },
      orderBy: { createdAt: "asc" },
    });
    assert(auditEntries.length === 2, `expected 2 audit entries, got ${auditEntries.length}`);
    const nameEntry = auditEntries[0].oldValues as { playerName: string; phone: string };
    const nameEntryNew = auditEntries[0].newValues as { playerName: string; phone: string };
    assert(
      nameEntry.playerName === "Typo Namez",
      `expected old name Typo Namez, got ${nameEntry.playerName}`,
    );
    assert(
      nameEntryNew.playerName === "Typo Names",
      `expected new name Typo Names, got ${nameEntryNew.playerName}`,
    );
    const phoneEntryOld = auditEntries[1].oldValues as { playerName: string; phone: string };
    const phoneEntryNew = auditEntries[1].newValues as { playerName: string; phone: string };
    assert(
      phoneEntryOld.phone === "09170000000",
      `expected old phone 09170000000, got ${phoneEntryOld.phone}`,
    );
    assert(
      phoneEntryNew.phone === "09179999999",
      `expected new phone 09179999999, got ${phoneEntryNew.phone}`,
    );
    console.log("PASS: both edits are logged to the audit trail with correct old/new values.");

    // ============== 4. A name correction propagates to QueueEntry and PlayerTab ==============
    const queueEntry = await prisma.queueEntry.create({
      data: {
        registrationId: registration.id,
        sessionId: null,
        date,
        playerName: registration.playerName,
        skillLevel: registration.skillLevel,
        joinedQueueAt: new Date(),
        status: "WAITING",
      },
    });
    const playerTab = await prisma.playerTab.create({
      data: {
        date,
        sessionId: null,
        registrationId: registration.id,
        playerName: registration.playerName,
        gameRateCents: 3500,
        status: "OPEN",
      },
    });

    await openPlayRegistrationService.updateRegistrationDetails(
      registration.id,
      { playerName: "Fixed Name" },
      owner.id,
    );

    const [updatedQueueEntry, updatedPlayerTab] = await Promise.all([
      prisma.queueEntry.findUniqueOrThrow({ where: { id: queueEntry.id } }),
      prisma.playerTab.findUniqueOrThrow({ where: { id: playerTab.id } }),
    ]);
    assert(
      updatedQueueEntry.playerName === "Fixed Name",
      `expected QueueEntry.playerName to be updated, got ${updatedQueueEntry.playerName}`,
    );
    assert(
      updatedPlayerTab.playerName === "Fixed Name",
      `expected PlayerTab.playerName to be updated, got ${updatedPlayerTab.playerName}`,
    );
    console.log(
      "PASS: a name correction propagates to QueueEntry and PlayerTab, not just the registration.",
    );

    console.log(
      "\nPASS: a typo'd name or phone number can be fixed on an existing registration without cancel/re-register.",
    );
  } finally {
    await prisma.auditLog.deleteMany({
      where: { entityType: "OpenPlayNightRegistration", entityId: registration.id },
    });
    await prisma.playerTab.deleteMany({ where: { registrationId: registration.id } });
    await prisma.queueEntry.deleteMany({ where: { registrationId: registration.id } });
    await prisma.openPlayNightRegistration.delete({ where: { id: registration.id } });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
