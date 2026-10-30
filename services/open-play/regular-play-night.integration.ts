/**
 * A Fri/Sat switched to regular play (owner, 2026-10-31: "change the unli
 * play for later to regular play, the 35 per game", then pick per court
 * which hours are booking). Proves against real rows:
 *   1. The switch is refused while anyone holds an Unliplay seat.
 *   2. Once on, the website takes no Unliplay registration for the night.
 *   3. The night's own court hours decide what can be booked, and
 *      switching back restores the Unliplay takeover.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { isWithinCourtBookingWindow } from "../../lib/court-hours";
import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { createPublicOpenPlayRegistration } from "./public-open-play-registration.service";

const NIGHT = new Date(2031, 3, 12); // Saturday, Apr 12 2031 — not used by other fixtures
const PHONE_PREFIX = "0917777";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: NIGHT } });
  if (session) {
    const regs = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id }, select: { id: true } });
    await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: regs.map((r) => r.id) } } });
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightSession.delete({ where: { id: session.id } });
  }
  await prisma.player.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } }).catch(() => undefined);
}

async function expectError(promise: Promise<unknown>, contains: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof Error && error.message.includes(contains), `expected "${contains}", got: ${error}`);
    return;
  }
  throw new Error(`FAIL: expected an error containing "${contains}"`);
}

async function main(): Promise<void> {
  await cleanUp();
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const session = await openPlayCapacityService.getOrCreateSessionForDate(NIGHT);

  // 1. Refused while a seat is held.
  const seated = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Paid Unliplay", phone: `${PHONE_PREFIX}001`, skillLevel: "BEGINNER" },
    owner.id,
  );
  await expectError(openPlayCapacityService.setRegularPlayForDate(NIGHT, true, owner.id), "registered for Unliplay");
  await prisma.openPlayNightRegistration.delete({ where: { id: seated.id } });
  await openPlayCapacityService.setRegularPlayForDate(NIGHT, true, owner.id);
  console.log("PASS: the switch is refused while a seat is held, and works once the night is empty.");

  // 2. No Unliplay registration on the website.
  const online = await createPublicOpenPlayRegistration({
    date: "2031-04-12",
    playerName: "Website Guest",
    phone: `${PHONE_PREFIX}002`,
    skillLevel: "BEGINNER",
  });
  assert(online.status === "date-blocked" || online.status === "disabled", `website should refuse, got ${online.status}`);
  const created = await prisma.openPlayNightRegistration.count({ where: { sessionId: session.id } });
  assert(created === 0, "the website must not create a registration on a regular-play night");
  console.log("PASS: the website takes no Unliplay registration on a regular-play night.");

  // 3. Court hours for the night.
  const courtHours = await settingsService.getCourtHours();
  const sevenPm = new Date(2031, 3, 12, 19);
  const eightPm = new Date(2031, 3, 12, 20);
  await openPlayCapacityService.setRegularPlayHoursForDate(NIGHT, { "Court 2": [] }, owner.id);
  const regular = await openPlayCapacityService.getCourtDateOverrides(NIGHT);
  assert(regular.regularPlayNight?.openPlayHours?.["Court 2"]?.length === 0, "the night's own hours should be read back");
  assert(
    isWithinCourtBookingWindow(courtHours, "Court 2", sevenPm, eightPm, regular.startTimeOverrideMinutes, regular.regularPlayNight),
    "Court 2 at 7 PM should be bookable when the night marks every hour as booking",
  );

  await openPlayCapacityService.setRegularPlayHoursForDate(NIGHT, { "Court 2": [19] }, owner.id);
  const withOpenPlay = await openPlayCapacityService.getCourtDateOverrides(NIGHT);
  assert(
    !isWithinCourtBookingWindow(courtHours, "Court 2", sevenPm, eightPm, undefined, withOpenPlay.regularPlayNight),
    "Court 2 at 7 PM should be open play once the night marks it so",
  );

  await openPlayCapacityService.setRegularPlayForDate(NIGHT, false, owner.id);
  const back = await openPlayCapacityService.getCourtDateOverrides(NIGHT);
  assert(back.regularPlayNight === undefined, "switching back should drop the regular-play hours");
  console.log("PASS: the night's own court hours decide bookings, and switching back restores Unliplay.");

  await cleanUp();
  console.log("\nPASS: regular-play night proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
