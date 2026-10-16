/**
 * Waitlist switched off (owner, 2026-10-16: "just a toggle button if we
 * allow waitlist … so no more waitlisted customers"; "if registration is
 * full kindly disable all buttons"). Proves against real rows that with
 * the switch off, a full Fri/Sat night:
 *   1. returns "full" to a website registrant and creates nothing;
 *   2. refuses a desk walk-in instead of waitlisting them;
 *   3. never offers a freed seat online — and, with the switch ON, still
 *      never offers one while online registration is blocked for the night
 *      (blocked at 8:36 PM on Oct 16, yet 10:05 PM check-outs texted 7).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const NIGHT = new Date(2031, 3, 5); // Saturday, Apr 5 2031 — not used by other fixtures
const PHONE_PREFIX = "0917666";

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
  await prisma.player.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } }).catch(() => undefined);
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const original = await settingsService.getOpenPlaySettings();

  try {
    await settingsService.setOpenPlaySettings({ ...original, waitlistEnabled: false }, owner.id);
    const session = await prisma.openPlayNightSession.create({
      data: { date: NIGHT, startAt: new Date(2031, 3, 5, 18), endAt: new Date(2031, 3, 5, 23), capacity: 1 },
    });
    const seated = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Only Seat", phone: `${PHONE_PREFIX}001`, skillLevel: "BEGINNER" },
      owner.id,
    );

    // 1. Website.
    const online = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Too Late",
      phone: `${PHONE_PREFIX}002`,
      skillLevel: "BEGINNER",
    });
    assert(online.kind === "full", `expected "full", got ${online.kind}`);
    assert(
      (await prisma.openPlayWaitlistEntry.count({ where: { sessionId: session.id } })) === 0,
      "a full night with the waitlist off must not create a waitlist entry",
    );
    console.log("PASS: website registration on a full night returns 'full' and creates nothing.");

    // 2. Desk.
    let refused = false;
    try {
      await openPlayRegistrationService.registerWalkIn(
        session.id,
        { playerName: "Desk Late", phone: `${PHONE_PREFIX}003`, skillLevel: "BEGINNER" },
        owner.id,
      );
    } catch (error) {
      refused = error instanceof Error && error.message.includes("Tonight is full");
    }
    assert(refused, "a desk walk-in on a full night should be refused, not waitlisted");
    console.log("PASS: desk walk-in on a full night is refused, not waitlisted.");

    // 3. Waitlist ON but the night blocked for online registration: a freed
    //    seat must not text anyone.
    await settingsService.setOpenPlaySettings({ ...original, waitlistEnabled: true }, owner.id);
    await openPlayRegistrationService.submitOnlineRegistration(session.id, {
      playerName: "Online Waiter",
      phone: `${PHONE_PREFIX}004`,
      skillLevel: "BEGINNER",
    });
    await prisma.openPlayNightSession.update({ where: { id: session.id }, data: { onlineRegistrationBlocked: true } });
    await openPlayRegistrationService.markCheckedOut(seated.id, owner.id);
    const entry = await prisma.openPlayWaitlistEntry.findFirstOrThrow({ where: { sessionId: session.id } });
    assert(entry.status === "WAITING", `blocked night: expected no invite, got ${entry.status}`);
    console.log("PASS: a night blocked for online registration never texts a seat offer.");

    console.log("\nPASS: waitlist switch proven against real rows.");
  } finally {
    await settingsService.setOpenPlaySettings(original, owner.id);
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
