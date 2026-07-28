/**
 * Owner decision (Fri/Sat waitlist rework): "A desk walk-in on a FULL
 * night is NOT registered and NOT charged... They may optionally be
 * added to the walk-in waiting roster at ZERO charge." registerWalkIn
 * previously called createOpenPlayRegistrationFeeSale unconditionally —
 * charging the ₱150 fee even when the new row landed waitlisted
 * (waitlistPos set), not seated. This proves the fix: a walk-in that
 * takes a real seat is charged; a walk-in that lands on the waiting
 * roster is not.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayRegistrationService } from "./open-play-registration.service";

const TEST_SESSION_DATE = new Date(2031, 0, 10); // Friday, Jan 10 2031 — far enough out not to collide with real usage
const TEST_CAPACITY = 1;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function cleanUp(): Promise<void> {
  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: TEST_SESSION_DATE } });
  if (existing) {
    const registrations = await prisma.openPlayNightRegistration.findMany({
      where: { sessionId: existing.id },
      select: { id: true },
    });
    const ids = registrations.map((r) => r.id);
    await prisma.sale.deleteMany({ where: { openPlayNightRegistrationId: { in: ids } } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }
}

async function main(): Promise<void> {
  await cleanUp();

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-WAITLISTPAY-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  const session = await prisma.openPlayNightSession.create({
    data: {
      date: TEST_SESSION_DATE,
      startAt: new Date(2031, 0, 10, 18, 0),
      endAt: new Date(2031, 0, 10, 23, 0),
      capacity: TEST_CAPACITY,
    },
  });

  const saleContext = {
    method: "CASH" as const,
    gcashReference: null,
    paymentMethodId: cashMethod.id,
    employeeId: ownerEmployee.id,
    shiftId: shift.id,
  };

  // First walk-in: capacity 1, nobody seated yet — takes the real seat.
  const seatedReg = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Waitlist Pay Seated", phone: "09170000101", skillLevel: "INTERMEDIATE" },
    owner.id,
    saleContext,
  );
  console.log(`Seated registration: waitlistPos=${seatedReg.waitlistPos}`);
  assert(seatedReg.waitlistPos === null, `expected the first walk-in to take the seat, got waitlistPos=${seatedReg.waitlistPos}`);

  const seatedSale = await prisma.sale.findFirst({ where: { openPlayNightRegistrationId: seatedReg.id } });
  console.log(`Sale for seated walk-in: ${seatedSale ? `yes, ${seatedSale.amountCents} cents` : "no"}`);
  assert(seatedSale !== null, "expected a Sale for the walk-in that took a real seat");
  assert(seatedSale.amountCents === 15000, `expected the ₱150 fee (15000 cents), got ${seatedSale.amountCents}`);

  // Second walk-in: capacity already full — lands on the waiting roster.
  const waitlistedReg = await openPlayRegistrationService.registerWalkIn(
    session.id,
    { playerName: "Waitlist Pay Waiting", phone: "09170000102", skillLevel: "INTERMEDIATE" },
    owner.id,
    saleContext,
  );
  console.log(`Waitlisted registration: waitlistPos=${waitlistedReg.waitlistPos}`);
  assert(waitlistedReg.waitlistPos !== null, `expected the second walk-in to land on the waiting roster, got waitlistPos=${waitlistedReg.waitlistPos}`);

  const waitlistedSale = await prisma.sale.findFirst({ where: { openPlayNightRegistrationId: waitlistedReg.id } });
  console.log(`Sale for waitlisted walk-in: ${waitlistedSale ? `yes, ${waitlistedSale.amountCents} cents (BUG)` : "no (correct)"}`);
  assert(waitlistedSale === null, "expected NO Sale for a walk-in that landed on the waiting roster, not a real seat");

  await cleanUp();
  console.log("PASS: a walk-in is charged only when it takes a real seat; a waitlisted walk-in is registered at zero charge.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
