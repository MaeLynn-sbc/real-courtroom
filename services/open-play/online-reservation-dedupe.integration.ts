/**
 * Duplicate online reservations (owner, 2026-10-17). Customers switched to
 * GCash, came back to a reloaded page and reserved again; the first hold sat
 * unpaid on a seat (Drey twice; Miguel, John, Albert once each — all deleted
 * by hand). Proves against real rows:
 *   1. The same name + phone while the hold is live gets the SAME hold back
 *      (+63 and spacing differences included) — no second seat.
 *   2. One phone reserving for someone else (a group) still gets a seat each.
 *   3. Holds last OPEN_PLAY_HOLD_MINUTES (10).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { OPEN_PLAY_HOLD_MINUTES } from "../../lib/open-play-seats";
import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

const NIGHT = new Date(2031, 3, 12); // Saturday, Apr 12 2031 — not used by other fixtures

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: NIGHT } });
  if (session) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightSession.delete({ where: { id: session.id } });
  }
}

async function main(): Promise<void> {
  await cleanUp();
  try {
    const session = await prisma.openPlayNightSession.create({
      data: { date: NIGHT, startAt: new Date(2031, 3, 12, 18), endAt: new Date(2031, 3, 12, 23), capacity: 10 },
    });
    const first = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Drey",
      phone: "09630427881",
      skillLevel: "BEGINNER",
    });
    assert(first.kind === "registered", "first reservation should hold a seat");
    const minutes = (first.registration.holdExpiresAt!.getTime() - Date.now()) / 60_000;
    assert(
      minutes > OPEN_PLAY_HOLD_MINUTES - 1 && minutes <= OPEN_PLAY_HOLD_MINUTES,
      `hold should last ${OPEN_PLAY_HOLD_MINUTES} minutes, got ${minutes.toFixed(1)}`,
    );
    console.log(`PASS: an online hold lasts ${OPEN_PLAY_HOLD_MINUTES} minutes.`);

    const again = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "  drey ",
      phone: "+63 963 042 7881",
      skillLevel: "BEGINNER",
    });
    assert(
      again.kind === "registered" && again.registration.id === first.registration.id,
      "the same person reserving again should get the same hold back",
    );
    const holds = await prisma.openPlayNightRegistration.count({ where: { sessionId: session.id } });
    assert(holds === 1, `expected 1 reservation, found ${holds}`);
    console.log("PASS: reserving again (same name + phone, any format) returns the same hold — no second seat.");

    const friend = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Drey's Friend",
      phone: "09630427881",
      skillLevel: "BEGINNER",
    });
    assert(
      friend.kind === "registered" && friend.registration.id !== first.registration.id,
      "a different name on the same phone (a group) should get its own seat",
    );
    console.log("PASS: one phone reserving for a friend still gets a separate seat.");

    console.log("\nPASS: duplicate online reservations prevented, proven against real rows.");
  } finally {
    await cleanUp();
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
