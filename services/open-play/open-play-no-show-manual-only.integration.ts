/**
 * Owner decision (Fri/Sat waitlist rework): "No automatic no-show
 * release. Players legitimately arrive late (8pm+). Seats are freed by
 * explicit staff action only." reconcileNoShows used to run
 * automatically at the top of every getCheckInScreenData read for a
 * Fri/Sat session; it no longer does. This proves a registration well
 * past the no-show cutoff stays CONFIRMED, untouched, after loading the
 * check-in screen — no silent release.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_SESSION_DATE = new Date(2031, 0, 17); // Friday, Jan 17 2031 — far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_SESSION_DATE } });
  if (existing) {
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const { noShowReleaseMinutes } = await settingsService.getOpenPlaySettings();

  // startAt is well beyond noShowReleaseMinutes in the past — under the
  // old automatic behavior, this registration would have been marked
  // NO_SHOW the instant getCheckInScreenData ran.
  const startAt = new Date(Date.now() - (noShowReleaseMinutes + 120) * 60_000);
  const session = await prisma.openPlayNightSession.create({
    data: {
      date: TEST_SESSION_DATE,
      startAt,
      endAt: new Date(startAt.getTime() + 5 * 60 * 60 * 1000),
      capacity: 10,
    },
  });

  const registration = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Late Arrival No Show Test", phone: "09170000201", skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  assert(registration.status === "CONFIRMED", `expected CONFIRMED right after registering, got ${registration.status}`);

  const screenData = await openPlayCheckinService.getCheckInScreenData({ sessionId: session.id });
  const stillExpected = screenData.expected.some((r) => r.id === registration.id);
  console.log(`Still in Expected after loading the check-in screen, well past the old cutoff: ${stillExpected}`);
  assert(stillExpected, "expected the registration to still be in Expected — no automatic release should have happened");

  const afterRead = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: registration.id } });
  console.log(`Registration status after the read: ${afterRead.status}`);
  assert(afterRead.status === "CONFIRMED", `expected status to stay CONFIRMED, got ${afterRead.status} — automatic release fired`);

  await cleanUp();
  console.log("PASS: no-show release no longer fires automatically — a late-but-unreleased registration survives loading the check-in screen untouched.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
