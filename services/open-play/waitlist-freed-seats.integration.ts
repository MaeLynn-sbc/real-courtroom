/**
 * Freed Fri/Sat seats (owner, 2026-10-10). Replays that Saturday:
 *   capacity raised → the seat went to the online waitlist (Mark), Joshua
 *   registered at the desk → waitlisted, Mark's hold deleted → the seat
 *   freed and NOBODY moved up; Joshua's GCash payment was never recorded.
 * Proves against real rows:
 *   1. Raising capacity seats a desk walk-in BEFORE inviting online.
 *   2. Deleting a seat-holding online hold seats the walk-in waitlist head.
 *   3. Take payment records the ₱150 once, and refuses a second time.
 *   4. Seat now refuses when every seat is taken, and otherwise seats the
 *      player and records the payment in one step.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "./open-play-capacity.service";
import { openPlayRegistrationService } from "./open-play-registration.service";

const NIGHT = new Date(2031, 2, 15); // Saturday, Mar 15 2031 — not used by other fixtures
const PHONE_PREFIX = "0917444";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

let shiftId: string | null = null;

async function cleanUp(): Promise<void> {
  const session = await prisma.openPlayNightSession.findUnique({ where: { date: NIGHT } });
  if (session) {
    const regs = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: session.id }, select: { id: true } });
    const ids = regs.map((r) => r.id);
    await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: ids } } });
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: session.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { id: { in: ids } } });
    await prisma.openPlayNightSession.delete({ where: { id: session.id } });
  }
  if (shiftId) {
    await prisma.sale.deleteMany({ where: { shiftId } });
    await prisma.shift.delete({ where: { id: shiftId } }).catch(() => undefined);
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
  const employee = await prisma.employee.findFirstOrThrow({ where: { userId: owner.id } });
  const gcash = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const shift = await prisma.shift.create({
    data: { shiftNumber: `TEST-WAITLIST-${Date.now()}`, employeeId: employee.id, openingCashCents: 0 },
  });
  shiftId = shift.id;
  const saleContext = {
    method: "GCASH" as const,
    gcashReference: "1234567",
    paymentMethodId: gcash.id,
    employeeId: employee.id,
    shiftId: shift.id,
  };

  const session = await prisma.openPlayNightSession.create({
    data: { date: NIGHT, startAt: new Date(2031, 2, 15, 18), endAt: new Date(2031, 2, 15, 23), capacity: 1 },
  });
  const walkIn = (name: string, suffix: string) =>
    openPlayRegistrationService.registerWalkIn(
      session.id,
      { playerName: name, phone: `${PHONE_PREFIX}${suffix}`, skillLevel: "BEGINNER" },
      owner.id,
    );

  await walkIn("Seated First", "001");
  const mark = await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: "Mark",
    phone: `${PHONE_PREFIX}002`,
    skillLevel: "BEGINNER",
  });
  assert(mark.kind === "waitlisted", "Mark should land on the online waitlist on a full night");

  // Saturday's order: capacity up with nobody waiting at the desk → Mark is invited.
  const raised = await openPlayCapacityService.setSessionCapacityOverride(NIGHT, 2, owner.id);
  assert(raised.invitedFromOnline.includes("Mark"), "raising capacity should report the online invite");
  const joshua = await walkIn("Joshua", "003");
  assert(joshua.waitlistPos === 1, "with Mark's hold on the seat, Joshua is waitlisted");

  // 2. Deleting Mark's hold must seat Joshua.
  const markHold = await prisma.openPlayNightRegistration.findFirstOrThrow({
    where: { sessionId: session.id, playerName: "Mark", status: "AWAITING_PAYMENT" },
  });
  await openPlayRegistrationService.deleteRegistration(markHold.id, owner.id);
  const joshuaAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({
    where: { id: joshua.id },
    include: { sale: true },
  });
  assert(joshuaAfter.waitlistPos === null, "deleting a seat-holding hold should seat the walk-in waitlist head");
  assert(joshuaAfter.sale === null, "an automatically seated walk-in is unpaid until Take payment");
  console.log("PASS: deleting the online hold seats Joshua (unpaid).");

  // 3. Take payment, once.
  await openPlayRegistrationService.collectRegistrationFee(joshua.id, saleContext, owner.id);
  const paid = await prisma.sale.findUnique({ where: { openPlayNightRegistrationId: joshua.id } });
  assert(paid && paid.paymentMethodId === gcash.id, "Take payment should record a GCash sale");
  await expectError(openPlayRegistrationService.collectRegistrationFee(joshua.id, saleContext, owner.id), "already paid");
  console.log("PASS: Take payment records the fee once and refuses a second time.");

  // 1. Capacity up while a walk-in waits at the desk → the walk-in gets it, not online.
  await openPlayRegistrationService.submitOnlineRegistration(session.id, {
    playerName: "Online Two",
    phone: `${PHONE_PREFIX}004`,
    skillLevel: "BEGINNER",
  });
  const desk = await walkIn("Desk Waiter", "005");
  assert(desk.waitlistPos === 1, "night full again — the desk walk-in waits");
  const raised3 = await openPlayCapacityService.setSessionCapacityOverride(NIGHT, 3, owner.id);
  assert(
    raised3.seatedFromWaitlist.includes("Desk Waiter") && raised3.invitedFromOnline.length === 0,
    `capacity +1 should seat the desk walk-in, not invite online (got ${JSON.stringify(raised3)})`,
  );
  console.log("PASS: raising capacity seats the walk-in at the desk before inviting online.");

  // 4. Seat now: refused when full, works when a seat is free.
  const late = await walkIn("Late Walk-in", "006");
  assert(late.waitlistPos === 1, "night full — the late walk-in waits");
  await expectError(openPlayRegistrationService.seatFromWaitlist(late.id, saleContext, owner.id), "Every seat is taken");
  // A seat freed without going through fillFreedSeats (an expired hold, in real life).
  await prisma.openPlayNightSession.update({ where: { id: session.id }, data: { capacity: 4 } });
  await openPlayRegistrationService.seatFromWaitlist(late.id, saleContext, owner.id);
  const lateAfter = await prisma.openPlayNightRegistration.findUniqueOrThrow({
    where: { id: late.id },
    include: { sale: true },
  });
  assert(lateAfter.waitlistPos === null && lateAfter.sale !== null, "Seat now should seat AND record the payment");
  console.log("PASS: Seat now refuses a full night, otherwise seats and records the payment together.");

  await cleanUp();
  console.log("\nPASS: freed Fri/Sat seats proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
