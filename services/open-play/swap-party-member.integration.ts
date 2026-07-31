/**
 * "build the group swap same as tv display" — the Next up preview box has
 * no editable party roster (it shows flattened members, same as the TV
 * kiosk it mirrors), so a forming group short on skill fit is fixed by
 * trading one player for another rather than editing the group directly.
 *
 * Proves, against real rows:
 *   1. Swapping a solo player with a party member correctly exchanges
 *      partyId on BOTH the QueueEntry (what the rotation board actually
 *      groups by) and the OpenPlayNightRegistration row, for both sides.
 *   2. The player left behind (Carla) is untouched — she's still in the
 *      party, just with a different partner now.
 *   3. Swapping two players already in the same group is rejected.
 *   4. Swapping a player who isn't currently waiting is rejected.
 *   5. A successful swap writes an audit log entry.
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

async function assertThrows(
  fn: () => Promise<unknown>,
  messageIncludes: string,
  label: string,
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(
      message.includes(messageIncludes),
      `expected error to include "${messageIncludes}", got "${message}"`,
    );
    console.log(`PASS: ${label}`);
    return;
  }
  throw new Error(`FAIL: ${label} — expected an error but none was thrown`);
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  // A plain Tuesday — regular open play, no Fri/Sat capacity concerns.
  const date = new Date();
  date.setDate(date.getDate() + ((2 - date.getDay() + 7) % 7 || 7));
  date.setHours(0, 0, 0, 0);

  const alice = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    { playerName: "Alice Swap", phone: "09171111111", skillLevel: "BEGINNER" },
    owner.id,
  );
  const ben = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    {
      playerName: "Ben Swap",
      phone: "09172222222",
      skillLevel: "BEGINNER",
      partyId: "party-swap-test",
    },
    owner.id,
  );
  const carla = await openPlayRegistrationService.registerWeeknightWalkIn(
    date,
    {
      playerName: "Carla Swap",
      phone: "09173333333",
      skillLevel: "BEGINNER",
      partyId: "party-swap-test",
    },
    owner.id,
  );

  const joinedQueueAt = new Date();
  const queueEntries = await Promise.all(
    [
      { registration: alice, partyId: null },
      { registration: ben, partyId: "party-swap-test" },
      { registration: carla, partyId: "party-swap-test" },
    ].map(({ registration, partyId }) =>
      prisma.queueEntry.create({
        data: {
          registrationId: registration.id,
          sessionId: null,
          date,
          playerName: registration.playerName,
          skillLevel: registration.skillLevel,
          partyId,
          joinedQueueAt,
          status: "WAITING",
        },
      }),
    ),
  );

  try {
    // ============== 1 & 2. Swapping exchanges partyId on both tables, leaves the third player untouched ==============
    await openPlayRotationService.swapPartyMember(date, alice.id, ben.id, owner.id);

    const [aliceQueue, benQueue, carlaQueue] = await Promise.all([
      prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: alice.id } }),
      prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: ben.id } }),
      prisma.queueEntry.findUniqueOrThrow({ where: { registrationId: carla.id } }),
    ]);
    const [aliceReg, benReg] = await Promise.all([
      prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: alice.id } }),
      prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: ben.id } }),
    ]);

    assert(
      aliceQueue.partyId === "party-swap-test",
      `expected Alice's QueueEntry to join the party, got ${aliceQueue.partyId}`,
    );
    assert(
      benQueue.partyId === null,
      `expected Ben's QueueEntry to become solo, got ${benQueue.partyId}`,
    );
    assert(
      aliceReg.partyId === "party-swap-test",
      `expected Alice's registration to join the party, got ${aliceReg.partyId}`,
    );
    assert(
      benReg.partyId === null,
      `expected Ben's registration to become solo, got ${benReg.partyId}`,
    );
    assert(
      carlaQueue.partyId === "party-swap-test",
      "expected Carla to remain in the party, untouched",
    );
    console.log(
      "PASS: swapping exchanges partyId on both QueueEntry and OpenPlayNightRegistration, for both players.",
    );
    console.log("PASS: the third player (Carla) is left in the party, untouched.");

    // ============== 3. Rejects swapping two players already in the same group ==============
    await assertThrows(
      () => openPlayRotationService.swapPartyMember(date, alice.id, carla.id, owner.id),
      "already in the same group",
      "rejects swapping two players already in the same group.",
    );

    // ============== 4. Rejects swapping a player who isn't currently waiting ==============
    await prisma.queueEntry.update({
      where: { id: queueEntries.find((e) => e.registrationId === carla.id)!.id },
      data: { status: "DONE" },
    });
    await assertThrows(
      () => openPlayRotationService.swapPartyMember(date, alice.id, carla.id, owner.id),
      "must currently be waiting",
      "rejects swapping a player who isn't currently waiting.",
    );

    // ============== 5. Writes an audit log entry ==============
    const auditEntry = await prisma.auditLog.findFirst({
      where: { entityType: "QueueEntry", action: "queue_entry.party_swapped", entityId: alice.id },
    });
    assert(auditEntry, "expected a queue_entry.party_swapped audit log entry");
    console.log("PASS: a successful swap writes an audit log entry.");

    console.log(
      "\nPASS: staff can trade one waiting player for another between groups, correctly and safely.",
    );
  } finally {
    await prisma.auditLog.deleteMany({
      where: { entityType: "QueueEntry", entityId: { in: [alice.id, ben.id, carla.id] } },
    });
    await prisma.queueEntry.deleteMany({
      where: { registrationId: { in: [alice.id, ben.id, carla.id] } },
    });
    await prisma.openPlayNightRegistration.deleteMany({
      where: { id: { in: [alice.id, ben.id, carla.id] } },
    });
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
