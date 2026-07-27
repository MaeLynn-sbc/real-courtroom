/**
 * Open-play online self-registration, Gate 2 — proves the cross-feature
 * interaction between the pre-existing staff walk-in path and the new
 * online path, the exact class of gap this project's own process has
 * caught before (Coaching x Phase 8): a genuinely new interaction that
 * exists in neither feature alone.
 *
 * 1. An online AWAITING_PAYMENT hold occupies a seat a walk-in must not
 *    be able to take — registerWalkIn's capacity check was widened
 *    (countOccupiedSeats) specifically for this.
 * 2. Cancelling that online hold correctly frees the seat for a walk-in
 *    afterward — releaseRegistration's status guard was widened
 *    (previously CONFIRMED-only) specifically for this; found BY this
 *    test failing during development, not assumed fixed.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 1, 14); // Friday, Feb 14 2031

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function cleanUpTestSession(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_DATE } });
  if (existing) {
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  await cleanUpTestSession();

  try {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    // Gate 2 review follow-up: raise the lead-time window so the new
    // registration-opens-N-days-before check (proven on its own in
    // open-play-registration-lead-time.integration.ts) doesn't reject
    // this file's far-future fixture date.
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 100_000 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await openPlayCapacityService.setSessionCapacityOverride(TEST_DATE, 1, owner.id);
    console.log("Both gates on, capacity set to 1.");

    const onlineResult = await createPublicOpenPlayRegistration({
      playerName: "Online Holder",
      phone: "09170000020",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    assert(onlineResult.status === "registered", `expected the online hold to be created, got ${onlineResult.status}`);
    if (onlineResult.status !== "registered") throw new Error("unreachable");
    console.log(`Online hold created for the session's only seat (registrationId=${onlineResult.registrationId}).`);

    const session = await prisma.openPlayNightSession.findUniqueOrThrow({ where: { date: TEST_DATE } });

    // --- Interaction 1: a walk-in must not seat itself on top of the hold ---
    const walkIn = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Walk-in Arrival", phone: "09170000021", skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    console.log(`Walk-in result: status=${walkIn.status}, waitlistPos=${walkIn.waitlistPos}`);
    assert(
      walkIn.status === "CONFIRMED" && walkIn.waitlistPos !== null,
      `expected the walk-in to land on the WALK-IN waitlist (capacity already spoken for by the online hold), got status=${walkIn.status} waitlistPos=${walkIn.waitlistPos}`,
    );
    console.log("PASS: a walk-in cannot seat itself on top of an active online hold — correctly waitlisted instead.");

    // --- Interaction 2: cancelling the online hold frees the seat for the walk-in waitlist ---
    await openPlayRegistrationService.cancelRegistration(onlineResult.registrationId, owner.id);
    const walkInAfterCancel = await prisma.openPlayNightRegistration.findUniqueOrThrow({ where: { id: walkIn.id } });
    console.log(`Walk-in after online hold cancelled: status=${walkInAfterCancel.status}, waitlistPos=${walkInAfterCancel.waitlistPos}`);
    assert(
      walkInAfterCancel.waitlistPos === null,
      `expected cancelling the online hold to promote the walk-in off the waitlist, got waitlistPos=${walkInAfterCancel.waitlistPos}`,
    );
    console.log("PASS: cancelling the online hold correctly released its seat and promoted the waiting walk-in.");

    await cleanUpTestSession();
    console.log("\nPASS: walk-in x online-hold interaction proven both directions against real rows.");
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await settingsService.setOpenPlaySettings(
      { ...(await settingsService.getOpenPlaySettings()), onlineRegistrationLeadTimeDays: 4 },
      owner.id,
    );
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to ON (verified: ${restored === true}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
