/**
 * Open-play online self-registration, Gate 2 review follow-up — proves
 * the owner-editable registration-opens-N-days-before-the-session
 * window (openPlaySettingsSchema.onlineRegistrationLeadTimeDays),
 * enforced in createPublicOpenPlayRegistration between the two existing
 * on/off gates and the capacity check.
 *
 * Uses a fixed, far-future Friday fixture date (same convention as
 * every other Gate 2 integration test, chosen specifically to avoid
 * colliding with real dev-DB data) and computes how many real calendar
 * days that is from actual "now" at runtime, then sets the lead-time
 * setting to exactly that number (and one less) to prove the boundary
 * precisely in both directions — not a hardcoded near-future date that
 * would drift out of range as real time passes.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 3, 4); // Friday, Apr 4 2031 — distinct from other integration fixtures' dates

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

  assert(TEST_DATE.getDay() === 5, `fixture date must be a Friday, got day ${TEST_DATE.getDay()}`);

  await cleanUpTestSession();

  const originalSettings = await settingsService.getOpenPlaySettings();

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const daysUntilSession = Math.round((TEST_DATE.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));
  console.log(`Fixture date is ${daysUntilSession} real calendar days from today.`);

  try {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);

    // --- Exactly at the boundary: lead time == days until session -> open ---
    await settingsService.setOpenPlaySettings(
      { ...originalSettings, onlineRegistrationLeadTimeDays: daysUntilSession },
      owner.id,
    );
    const atBoundary = await createPublicOpenPlayRegistration({
      playerName: "Boundary Guest",
      phone: "09170000070",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    console.log(`Lead time = ${daysUntilSession} (exact match): status=${atBoundary.status}`);
    assert(
      atBoundary.status === "registered",
      `expected exactly-at-boundary to be accepted (registered), got ${atBoundary.status}`,
    );
    console.log("PASS: a lead time exactly equal to the days-until-session accepts the submission.");

    await cleanUpTestSession();

    // --- One day short of the boundary: same date, now rejected ---
    await settingsService.setOpenPlaySettings(
      { ...originalSettings, onlineRegistrationLeadTimeDays: daysUntilSession - 1 },
      owner.id,
    );
    const oneDayShort = await createPublicOpenPlayRegistration({
      playerName: "Too Early Guest",
      phone: "09170000071",
      skillLevel: "INTERMEDIATE",
      date: dateValue(TEST_DATE),
    });
    console.log(`Lead time = ${daysUntilSession - 1} (one short): status=${oneDayShort.status}`);
    assert(
      oneDayShort.status === "not-yet-open",
      `expected one-day-short-of-the-window to be rejected as not-yet-open, got ${oneDayShort.status}`,
    );
    if (oneDayShort.status !== "not-yet-open") throw new Error("unreachable");

    const expectedOpensAt = new Date(TEST_DATE.getTime() - (daysUntilSession - 1) * 24 * 60 * 60 * 1000);
    assert(
      oneDayShort.opensAt.getTime() === expectedOpensAt.getTime(),
      `expected opensAt ${expectedOpensAt.toISOString()}, got ${oneDayShort.opensAt.toISOString()}`,
    );
    console.log(`PASS: a lead time one day short of the window rejects with status=not-yet-open and the correct opensAt (${oneDayShort.opensAt.toDateString()}).`);

    // No session/registration/waitlist row should exist at all for a
    // rejected submission — same "no row, no cleanup" shape as a
    // capacity-full waitlisting, just for a different reason.
    const noRegistration = await prisma.openPlayNightRegistration.findFirst({ where: { phone: "09170000071" } });
    assert(noRegistration === null, "expected NO registration row for a not-yet-open submission");
    const noWaitlistEntry = await prisma.openPlayWaitlistEntry.findFirst({ where: { phone: "09170000071" } });
    assert(noWaitlistEntry === null, "expected NO waitlist entry for a not-yet-open submission");
    console.log("PASS: a not-yet-open submission creates no registration and no waitlist entry.");

    await cleanUpTestSession();
    console.log("\nPASS: registration lead-time window enforced precisely at its boundary, both directions.");
  } finally {
    await settingsService.setOpenPlayOnlineRegistrationEnabled(true, owner.id);
    await openPlayCapacityService.setOnlineRegistrationEnabledForDay(5, true, owner.id);
    await settingsService.setOpenPlaySettings(originalSettings, owner.id);
    const restored = await settingsService.getOpenPlayOnlineRegistrationEnabled();
    console.log(`Feature-wide switch restored to ON (verified: ${restored === true}).`);
  }

  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
