/**
 * Review follow-up: "getOpenPlayParticipation now reads real data —
 * nothing asserts the new numbers are correct, that's the stale-report
 * problem again, just less visible." Known fixture, exact expected
 * output, per BUILD-SPEC.md §9 "Analytics: Fri/Sat participation scope"
 * (the scope + status-filter decisions this test locks in):
 *
 *   - Fri/Sat only: registrationsCount/checkedInCount/noShowCount are
 *     scoped to sessionId != null. Weeknight activity is counted
 *     separately (weeknightCheckedInCount), not mixed in and not
 *     dropped.
 *   - CANCELLED excluded from registrationsCount; NO_SHOW included.
 *
 * Fixture: one Friday session, 3 confirmed+checked-in, 2 no-shows, 1
 * cancelled — plus one weeknight check-in on a separate date in the same
 * query range, to prove it's counted separately and doesn't bleed into
 * the Fri/Sat numbers (or get dropped).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { analyticsService } from "./analytics.service";
import { openPlayCapacityService } from "../open-play/open-play-capacity.service";
import { openPlayCheckinService } from "../open-play/open-play-checkin.service";
import { openPlayRegistrationService } from "../open-play/open-play-registration.service";

const WEEKNIGHT_DATE = new Date(2031, 1, 4); // Tuesday — distinct from other fixtures, in Feb to avoid Jan collisions

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let phoneCounter = 960000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

// checkIn opens a PlayerTab per registration (BUILD-SPEC.md §6/§9) — must
// be cleared before the registration it references.
async function cleanUpRegistrations(where: { sessionId: string } | { date: Date }): Promise<void> {
  const registrations = await prisma.openPlayNightRegistration.findMany({ where, select: { id: true } });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.queueEntry.deleteMany({ where });
  await prisma.openPlayNightRegistration.deleteMany({ where });
}

async function cleanUpFriday(friday: Date): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: friday } });
  if (!session) return;
  await cleanUpRegistrations({ sessionId: session.id });
  await prisma.openPlayNightSession.delete({ where: { id: session.id } });
}

async function cleanUpWeeknight(): Promise<void> {
  await cleanUpRegistrations({ date: WEEKNIGHT_DATE });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const upcoming = await openPlayCapacityService.getUpcomingNights(30);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 30 days");
  await cleanUpFriday(friday!);
  await cleanUpWeeknight();

  const session = await openPlayCapacityService.getOrCreateSessionForDate(friday!);

  // 3 confirmed + checked in.
  for (let i = 0; i < 3; i++) {
    const reg = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: `Checked In ${i}`, phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(reg.id, owner.id);
  }
  // 2 no-shows — registered, never checked in, explicitly marked.
  for (let i = 0; i < 2; i++) {
    const reg = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: `No Show ${i}`, phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayRegistrationService.markNoShow(reg.id, owner.id);
  }
  // 1 cancelled — a genuine opt-out, must be excluded from registrationsCount.
  const cancelledReg = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Cancelled Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  await openPlayRegistrationService.cancelRegistration(cancelledReg.id, owner.id);

  // One weeknight check-in, same query range, must count separately.
  const weeknightReg = await openPlayRegistrationService.registerWeeknightWalkIn(
    WEEKNIGHT_DATE,
    { playerName: "Weeknight Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
    owner.id,
  );
  await openPlayCheckinService.checkIn(weeknightReg.id, owner.id);

  const rangeFrom = new Date(Math.min(session.date.getTime(), WEEKNIGHT_DATE.getTime()));
  const rangeTo = new Date(Math.max(session.date.getTime(), WEEKNIGHT_DATE.getTime()));

  try {
    const result = await analyticsService.getOpenPlayParticipation({ from: rangeFrom, to: rangeTo });

    assert(result.friSatSessionsCount === 1, `expected friSatSessionsCount 1, got ${result.friSatSessionsCount}`);
    assert(
      result.friSatRegistrationsCount === 5,
      `expected friSatRegistrationsCount 5 (3 checked-in + 2 no-show, excluding the 1 cancelled), got ${result.friSatRegistrationsCount}`,
    );
    assert(
      result.friSatCheckedInCount === 3,
      `expected friSatCheckedInCount 3, got ${result.friSatCheckedInCount}`,
    );
    assert(result.friSatNoShowCount === 2, `expected friSatNoShowCount 2, got ${result.friSatNoShowCount}`);
    assert(
      result.weeknightCheckedInCount === 1,
      `expected weeknightCheckedInCount 1 (counted separately, not folded into or dropped from the Fri/Sat numbers), got ${result.weeknightCheckedInCount}`,
    );

    console.log(
      "PASS: getOpenPlayParticipation matches a known fixture exactly — 1 session, 5 registrations (cancelled excluded), " +
        "3 checked in, 2 no-shows, 1 weeknight check-in counted separately",
    );
  } finally {
    await cleanUpFriday(friday!);
    await cleanUpWeeknight();
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
