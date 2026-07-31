/**
 * Reported live, revenue-affecting: walk-in registration on a Friday or
 * Saturday was ALWAYS routed into the P150 unlimited capacity system, at
 * every hour of the day — the page deciding this only ever checked the
 * calendar date, never whether Open Play had actually taken over the
 * courts yet (isBeforeFridaySaturdayOpenPlayCutoff, lib/court-hours.ts).
 * Fixed by switching the walk-in FORM's target (sessionId vs date) based
 * on that cutoff, while the capacity roster/queue/tabs stay visible all
 * day for staff prep.
 *
 * This proves, against real rows, that the underlying registration/tab
 * system a regular-mode walk-in on a Fri/Sat DATE goes through behaves
 * identically to any other day — no day-of-week special-casing anywhere
 * in that path — and that regular + unlimited registrations for the
 * same person on the same Friday coexist without conflict:
 *
 *   1. A regular-mode (sessionId: null) walk-in on a real upcoming
 *      Friday creates NO Sale at registration time (money only moves at
 *      tab settlement, same as any weeknight).
 *   2. Checking them in opens a tab at the REGULAR per-game rate
 *      (weeknightGameRateCents, ₱35 by default) — not ₱0, which is what
 *      a Fri/Sat CAPACITY registration's tab would show instead.
 *   3. Settling that tab after a credited game creates a correctly-
 *      attributed Sale (OPEN_PLAY, the per-game amount) — the exact
 *      same settlement path/assertions player-tab.integration.ts already
 *      proves for a weeknight date, just exercised on a Friday date this
 *      time, since that's the new, previously-untested scenario.
 *   4. The SAME player (same phone) can ALSO be registered into that
 *      Friday's real unlimited CAPACITY session (sessionId set) — two
 *      independent OpenPlayNightRegistration rows, neither blocking the
 *      other.
 *   5. getUpcomingNights' registeredCount for that Friday counts ONLY
 *      the capacity registration (sessionId-scoped, per
 *      open-play-capacity.service.ts's own groupBy) — the regular-mode
 *      registration must never inflate the unlimited session's own
 *      headcount.
 *   6. Once both are checked in, the rotation board (date-scoped, not
 *      sessionId-scoped — see open-play-rotation.service.ts) pools them
 *      into the SAME waiting queue, a real, accepted behavior change
 *      (owner decision: mixed foursomes are fine, billing stays correct
 *      per player) — and the capacity player's own tab still bills ₱0
 *      even while sitting in a mixed queue, proving pooling in the
 *      queue never leaks into billing.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayCheckinService } from "./open-play-checkin.service";
import { openPlayRegistrationService } from "./open-play-registration.service";
import { openPlayRotationService } from "./open-play-rotation.service";
import { playerTabService } from "./player-tab.service";
import { settingsService } from "../settings/settings.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let phoneCounter = 990000;
function nextPhone(): string {
  phoneCounter += 1;
  return String(phoneCounter);
}

async function cleanUpFridaySession(friday: Date): Promise<void> {
  // Both regular (sessionId: null) and capacity (sessionId set)
  // registrations for this date need cleaning — a plain `where: { date }`
  // catches both, unlike scoping only to the session.
  const registrations = await prisma.openPlayNightRegistration.findMany({
    where: { date: friday },
    select: { id: true },
  });
  const ids = registrations.map((r) => r.id);
  const tabs = await prisma.playerTab.findMany({ where: { registrationId: { in: ids } }, select: { id: true } });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({ where: { playerTabId: { in: tabIds } } });
  await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: ids } } });
  await prisma.tabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.playerTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.gameAssignmentParticipant.deleteMany({ where: { registrationId: { in: ids } } });
  await prisma.gameAssignment.deleteMany({ where: { date: friday } });
  await prisma.queueEntry.deleteMany({ where: { date: friday } });
  await prisma.openPlayNightRegistration.deleteMany({ where: { date: friday } });
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: friday } });
  if (session) {
    await prisma.openPlayNightSession.delete({ where: { id: session.id } });
  }
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-TEST-${Date.now()}`, employeeId: employee.id, status: "OPEN" },
    });
  }
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });
  const openPlaySettings = await settingsService.getOpenPlaySettings();

  const upcoming = await openPlayCapacityService.getUpcomingNights(14);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 14 days");

  await cleanUpFridaySession(friday!);

  try {
    const phone = nextPhone();

    // ============== 1+2. Regular-mode walk-in on a Friday: no Sale at registration, tab at the regular rate ==============
    const regularRegistration = await openPlayRegistrationService.registerWeeknightWalkIn(
      friday!,
      { playerName: "Regular Mode Friday Player", phone, skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    assert(regularRegistration.sessionId === null, "expected a regular-mode registration to have no sessionId");

    const saleAtRegistration = await prisma.sale.findUnique({
      where: { openPlayNightRegistrationId: regularRegistration.id },
    });
    assert(saleAtRegistration === null, "expected NO Sale at registration time for a regular-mode walk-in");
    console.log("PASS: a regular-mode walk-in on a Friday date creates no Sale at registration time.");

    await openPlayCheckinService.checkIn(regularRegistration.id, owner.id);
    const tab = await playerTabService.getTabViewByRegistration(regularRegistration.id);
    assert(tab, "check-in should have opened a tab");
    assert(
      tab!.tab.gameRateCents === openPlaySettings.weeknightGameRateCents,
      `expected the REGULAR per-game rate (${openPlaySettings.weeknightGameRateCents}) on a Friday regular-mode tab, got ${tab!.tab.gameRateCents}`,
    );
    console.log("PASS: a regular-mode registration's tab bills at the regular per-game rate, even on a Friday.");

    // ============== 3. Settling the tab after a credited game creates a correct Sale ==============
    await prisma.$transaction(async (tx) => {
      const assignment = await tx.gameAssignment.create({
        data: { courtId: court.id, date: friday!, skillSpread: 0, source: "AUTO", status: "DONE", startedAt: new Date(), endedAt: new Date() },
      });
      await tx.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId: regularRegistration.id } });
      await playerTabService.creditGame(regularRegistration.id, assignment.id, tx);
    });

    const settled = await playerTabService.settleTab(
      tab!.tab.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: paymentMethod.id },
      owner.id,
    );
    assert(settled.status === "SETTLED", "expected the tab to be SETTLED");

    const settlementSale = await prisma.sale.findUnique({ where: { playerTabId: tab!.tab.id } });
    assert(settlementSale, "expected settlement to create a Sale row");
    assert(
      settlementSale!.amountCents === openPlaySettings.weeknightGameRateCents,
      `expected settlement Sale amountCents ${openPlaySettings.weeknightGameRateCents}, got ${settlementSale!.amountCents}`,
    );
    assert(settlementSale!.category === "OPEN_PLAY", `expected category OPEN_PLAY, got ${settlementSale!.category}`);
    assert(settlementSale!.employeeId === employee.id, "expected the Sale attributed to the settling employee");
    assert(settlementSale!.shiftId === shift.id, "expected the Sale attributed to the settling shift");
    console.log("PASS: settling a regular-mode Friday tab creates a correctly-attributed Sale on the settling shift, same as any other day.");

    // ============== 4. The SAME player can ALSO register for that Friday's unlimited capacity session ==============
    const session = await openPlayCapacityService.getOrCreateSessionForDate(friday!);
    const capacityRegistration = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Regular Mode Friday Player", phone, skillLevel: "INTERMEDIATE" },
      owner.id,
      {
        method: "CASH",
        gcashReference: null,
        paymentMethodId: paymentMethod.id,
        employeeId: employee.id,
        shiftId: shift.id,
      },
    );
    assert(capacityRegistration.sessionId === session.id, "expected the capacity registration to carry the session's id");
    assert(capacityRegistration.id !== regularRegistration.id, "expected two independent registration rows, not one reused");

    const capacitySale = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: capacityRegistration.id } });
    assert(capacitySale, "expected the capacity registration to have its own ₱150 Sale");
    assert(
      capacitySale!.amountCents === openPlaySettings.friSatRegistrationFeeCents,
      `expected the capacity Sale amountCents ${openPlaySettings.friSatRegistrationFeeCents}, got ${capacitySale!.amountCents}`,
    );
    console.log("PASS: the same player can also register for that Friday's unlimited capacity session — two independent registrations, neither blocks the other.");

    // ============== 5. getUpcomingNights' registeredCount counts ONLY the capacity registration ==============
    const upcomingAfter = await openPlayCapacityService.getUpcomingNights(14);
    const fridayEntry = upcomingAfter.find((n) => n.date.getTime() === friday!.getTime());
    assert(fridayEntry, "expected the same Friday to still appear in getUpcomingNights");
    assert(
      fridayEntry!.registeredCount === 1,
      `expected registeredCount 1 (the capacity registration only, NOT the regular-mode one), got ${fridayEntry!.registeredCount}`,
    );
    console.log("PASS: the unlimited session's own registeredCount is unaffected by the regular-mode registration sharing its date.");

    // ============== 6. Mixed Friday: rotation board pools both check-ins, but billing stays correct per player ==============
    const secondCapacityRegistration = await openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: "Second Capacity Friday Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
      {
        method: "CASH",
        gcashReference: null,
        paymentMethodId: paymentMethod.id,
        employeeId: employee.id,
        shiftId: shift.id,
      },
    );
    await openPlayCheckinService.checkIn(secondCapacityRegistration.id, owner.id);

    const board = await openPlayRotationService.getRotationBoardData(friday!);
    const waitingRegistrationIds = board.waiting.flatMap((unit) => unit.members.map((m) => m.registrationId));
    assert(
      waitingRegistrationIds.includes(secondCapacityRegistration.id),
      "expected the capacity player to appear in the shared waiting queue",
    );
    // regularRegistration was already checked in (and later credited/
    // settled/closed out above) — re-check-in isn't possible on the same
    // row, so a THIRD fresh regular-mode registration proves the pooling
    // itself, independent of the earlier, already-settled one.
    const secondRegularRegistration = await openPlayRegistrationService.registerWeeknightWalkIn(
      friday!,
      { playerName: "Second Regular Friday Player", phone: nextPhone(), skillLevel: "INTERMEDIATE" },
      owner.id,
    );
    await openPlayCheckinService.checkIn(secondRegularRegistration.id, owner.id);
    const boardAfterBoth = await openPlayRotationService.getRotationBoardData(friday!);
    const idsAfterBoth = boardAfterBoth.waiting.flatMap((unit) => unit.members.map((m) => m.registrationId));
    assert(
      idsAfterBoth.includes(secondCapacityRegistration.id) && idsAfterBoth.includes(secondRegularRegistration.id),
      "expected BOTH a capacity and a regular-mode player to be pooled into the same waiting queue for this Friday",
    );
    console.log("PASS: the rotation board pools regular and capacity check-ins for the same Friday into one shared waiting queue (accepted owner decision).");

    // Billing stays correct per player even while pooled together.
    await prisma.$transaction(async (tx) => {
      const assignment = await tx.gameAssignment.create({
        data: { courtId: court.id, date: friday!, skillSpread: 0, source: "AUTO", status: "DONE", startedAt: new Date(), endedAt: new Date() },
      });
      await tx.gameAssignmentParticipant.create({ data: { assignmentId: assignment.id, registrationId: secondCapacityRegistration.id } });
      await playerTabService.creditGame(secondCapacityRegistration.id, assignment.id, tx);
    });
    const capacityTabAfterMixedQueue = await playerTabService.getTabViewByRegistration(secondCapacityRegistration.id);
    assert(capacityTabAfterMixedQueue, "expected the capacity player's tab to exist");
    assert(
      capacityTabAfterMixedQueue!.totalCents === 0,
      `expected the capacity player to still owe ₱0 for a game even while pooled with a regular-mode player, got ${capacityTabAfterMixedQueue!.totalCents}`,
    );
    console.log("PASS: pooling in the shared queue never leaks into billing — the capacity player still owes ₱0 per game.");

    await cleanUpFridaySession(friday!);
    console.log("\nPASS: regular open play on Fri/Sat is now reachable and behaves identically to any other day.");
  } catch (error) {
    await cleanUpFridaySession(friday!);
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
