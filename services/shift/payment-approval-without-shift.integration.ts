/**
 * Approving a payment verification (booking or open-play) no longer
 * requires the approver to have an open shift — reported live: the
 * Owner needing to clock in just to approve a GCash payment from home
 * was pure friction. Unlike booking creation
 * (booking-create-without-shift.integration.ts), there's no "skip the
 * shift" option here — Sale.shiftId is a required column, since
 * approving creates a real Sale immediately.
 *
 * Reported live again (2026-08-07): even WITH the synthetic-shift
 * fallback above, an approver who happened to have a real open shift
 * still got the Sale attributed to it — so a customer's online booking,
 * approved hours or days after a shift change, could land on a
 * completely different employee's real shift than whoever was on duty
 * when the customer actually booked, inflating that employee's "My
 * Shift" total with money they never handled. Fixed by always using the
 * synthetic bucket for this path, never the approver's real open shift.
 *
 * Proves, against real rows:
 *   1. An employee with NO open shift can still approve — a real Sale
 *      is created, attributed to a synthetic, CLOSED "not a real cash
 *      drawer" shift.
 *   2. A second approval by the SAME employee reuses that same
 *      synthetic shift — it isn't recreated every time.
 *   3. The synthetic shift never appears in listOpenShiftsWithEmployee
 *      (the "who's on duty" query) — approving a payment can never
 *      make someone show up as on duty.
 *   4. An employee who DOES have a real open shift still gets the Sale
 *      attributed to the SYNTHETIC bucket, not their real shift — the
 *      real shift's own sales total (what "My Shift" shows) stays at
 *      zero, and its cash reconciliation is untouched.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { openPlayCapacityService } from "../open-play/open-play-capacity.service";
import { openPlayRegistrationPaymentProofService } from "../open-play/open-play-registration-payment-proof.service";
import { openPlayRegistrationService } from "../open-play/open-play-registration.service";
import { saleService } from "../sales/sale.service";
import { shiftService } from "./shift.service";

const TEST_USERNAME_PREFIX = "it-payapproval-";
const OPEN_PLAY_TEST_DATE = new Date(2031, 5, 27); // Friday — distinct from other integration fixtures' dates

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
}

async function cleanUp(): Promise<void> {
  const users = await prisma.user.findMany({ where: { username: { startsWith: TEST_USERNAME_PREFIX } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  const employees = await prisma.employee.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const employeeIds = employees.map((e) => e.id);

  const existing = await prisma.openPlayNightSession.findUnique({ where: { date: OPEN_PLAY_TEST_DATE } });
  if (existing) {
    const registrations = await prisma.openPlayNightRegistration.findMany({ where: { sessionId: existing.id }, select: { id: true } });
    const ids = registrations.map((r) => r.id);
    await prisma.openPlayRegistrationPaymentProof.deleteMany({ where: { registrationId: { in: ids } } });
    await prisma.sale.deleteMany({ where: { openPlayNightRegistration: { sessionId: existing.id } } });
    await prisma.openPlayWaitlistEntry.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightRegistration.deleteMany({ where: { sessionId: existing.id } });
    await prisma.openPlayNightSession.delete({ where: { id: existing.id } });
  }

  await prisma.shift.deleteMany({ where: { employeeId: { in: employeeIds } } });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function registerAndSubmitProof(sessionId: string, playerName: string, phone: string) {
  const hold = await openPlayRegistrationService.submitOnlineRegistration(sessionId, {
    playerName,
    phone,
    skillLevel: "INTERMEDIATE",
  });
  assert(hold.kind === "registered", `expected a hold, got ${hold.kind}`);
  if (hold.kind !== "registered") throw new Error("unreachable");

  return openPlayRegistrationPaymentProofService.submitOpenPlayRegistrationPaymentProof({
    registrationId: hold.registration.id,
    gcashReference: null,
    submittedAmountCents: 15000,
    screenshot: screenshot(),
  });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  const role = await prisma.role.findFirstOrThrow({ where: { name: "OWNER" } });

  await cleanUp();

  try {
    await openPlayCapacityService.setSessionCapacityOverride(OPEN_PLAY_TEST_DATE, 8, owner.id);
    const session = await openPlayCapacityService.getOrCreateSessionForDate(OPEN_PLAY_TEST_DATE);

    // A fresh test employee, deliberately never given a shift.
    const suffix = Date.now();
    const noShiftUser = await prisma.user.create({
      data: { name: `${TEST_USERNAME_PREFIX}noshift-${suffix}`, username: `${TEST_USERNAME_PREFIX}noshift-${suffix}`, roleId: role.id },
    });
    const noShiftEmployee = await prisma.employee.create({
      data: {
        userId: noShiftUser.id,
        employeeNumber: `${TEST_USERNAME_PREFIX}noshift-${suffix}-num`,
        firstName: "No",
        lastName: "Shift",
      },
    });

    // ============== 1. Approve with no open shift succeeds ==============
    const proofA = await registerAndSubmitProof(session.id, "No Shift Approval A", "09171270001");
    const shiftA = await shiftService.resolveShiftForSaleAttribution(noShiftEmployee.id);
    assert(shiftA.status === "CLOSED", `expected the fallback shift to be CLOSED, got ${shiftA.status}`);

    const approveA = await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofA.id, {
      employeeId: noShiftEmployee.id,
      shiftId: shiftA.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });
    assert(!approveA.alreadyResolved, "expected the first approval to actually resolve");

    const saleA = await prisma.sale.findFirstOrThrow({ where: { shiftId: shiftA.id } });
    assert(saleA.employeeId === noShiftEmployee.id, "expected the Sale to attribute to the approving employee");
    assert(saleA.shiftId === shiftA.id, "expected the Sale to attribute to the synthetic shift");
    console.log("PASS: an employee with no open shift can approve — a real Sale is created against a synthetic CLOSED shift.");

    // ============== 2. A second approval reuses the SAME synthetic shift ==============
    const proofB = await registerAndSubmitProof(session.id, "No Shift Approval B", "09171270002");
    const shiftB = await shiftService.resolveShiftForSaleAttribution(noShiftEmployee.id);
    assert(shiftB.id === shiftA.id, "expected the second call to reuse the same synthetic shift, not create a new one");

    await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofB.id, {
      employeeId: noShiftEmployee.id,
      shiftId: shiftB.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });
    const salesOnShiftA = await prisma.sale.count({ where: { shiftId: shiftA.id } });
    assert(salesOnShiftA === 2, `expected both sales to land on the same reused shift, got ${salesOnShiftA}`);
    console.log("PASS: a second approval by the same employee reuses the same synthetic shift.");

    // ============== 3. The synthetic shift never shows as "on duty" ==============
    const onDuty = await shiftService.listOpenShiftsWithEmployee();
    assert(
      !onDuty.some((shift) => shift.employeeId === noShiftEmployee.id),
      "expected the no-shift employee to never appear in the on-duty list after approving payments",
    );
    console.log("PASS: approving payments never makes the employee show up as on duty.");

    // ============== 4. An employee WITH a real open shift still goes to the synthetic bucket ==============
    const withShiftUser = await prisma.user.create({
      data: { name: `${TEST_USERNAME_PREFIX}withshift-${suffix}`, username: `${TEST_USERNAME_PREFIX}withshift-${suffix}`, roleId: role.id },
    });
    const withShiftEmployee = await prisma.employee.create({
      data: {
        userId: withShiftUser.id,
        employeeNumber: `${TEST_USERNAME_PREFIX}withshift-${suffix}-num`,
        firstName: "With",
        lastName: "Shift",
      },
    });
    const realShift = await shiftService.startShift(withShiftEmployee.id, { openingCashCents: 0 }, owner.id);

    const proofC = await registerAndSubmitProof(session.id, "With Shift Approval C", "09171270003");
    const resolvedShift = await shiftService.resolveShiftForSaleAttribution(withShiftEmployee.id);
    assert(
      resolvedShift.id !== realShift.id,
      "expected an employee with a real open shift to STILL resolve to the synthetic bucket, not their real shift",
    );
    assert(resolvedShift.status === "CLOSED", `expected the synthetic bucket to be CLOSED, got ${resolvedShift.status}`);

    await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofC.id, {
      employeeId: withShiftEmployee.id,
      shiftId: resolvedShift.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });
    const saleC = await prisma.sale.findFirstOrThrow({ where: { employeeId: withShiftEmployee.id } });
    assert(saleC.shiftId === resolvedShift.id, "expected the Sale to attribute to the synthetic bucket");
    assert(saleC.shiftId !== realShift.id, "expected the Sale to NOT attribute to the employee's real open shift");
    console.log("PASS: an employee with a real open shift gets a payment-proof Sale attributed to the synthetic bucket, not their real shift.");

    // ============== 5. The real open shift's own totals stay untouched — "My Shift" isn't inflated ==============
    const realShiftSales = await saleService.getSalesForShift(realShift.id);
    assert(
      realShiftSales.totalAmountCents === 0 && realShiftSales.transactionCount === 0,
      `expected the real open shift's sales total to stay at zero, got ${realShiftSales.totalAmountCents} cents / ${realShiftSales.transactionCount} transactions`,
    );
    const realShiftCashSales = await saleService.getCashSalesForShift(realShift.id);
    assert(
      realShiftCashSales.totalAmountCents === 0,
      `expected the real open shift's cash reconciliation to stay untouched, got ${realShiftCashSales.totalAmountCents} cents`,
    );
    console.log("PASS: the real open shift's own sales total and cash reconciliation are untouched — 'My Shift' doesn't show the approval.");

    await cleanUp();
    console.log("\nPASS: approving a payment verification without an open shift proven against real rows.");
  } catch (error) {
    await cleanUp();
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
