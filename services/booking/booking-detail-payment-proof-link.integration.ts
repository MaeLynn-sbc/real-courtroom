/**
 * "Viewable after approval" (reported live): once a booking's GCash proof
 * was approved, nothing on the booking detail page pointed at it anymore
 * — getProofById() itself is status-unfiltered and already renders an
 * approved/rejected view fine, the gap was purely that getBookingById
 * never carried the proof reference through. Proves, against real rows,
 * that getBookingById surfaces the latest proof before submission (none),
 * while PENDING, and — the actual reported bug — after APPROVED.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 13); // Friday, distinct from other proof integration fixtures

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour,
    0,
  );
  const endAt = new Date(
    TEST_DATE.getFullYear(),
    TEST_DATE.getMonth(),
    TEST_DATE.getDate(),
    hour + 1,
    0,
  );
  return { startAt, endAt };
}

async function cleanUp(courtId: string): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  await prisma.sale.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "BookingPaymentProof" } });
  await prisma.bookingPaymentProof.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const websiteUser = await prisma.user.findFirstOrThrow({
    where: { email: "website@thecourtroom.local" },
  });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({
    where: { employeeId: ownerEmployee.id, status: "OPEN" },
  });
  if (!shift) {
    shift = await prisma.shift.create({
      data: {
        shiftNumber: `SHIFT-BOOKINGPROOFLINK-${Date.now()}`,
        employeeId: ownerEmployee.id,
        status: "OPEN",
      },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  try {
    const daySlot = slot(9);
    const hold = await bookingService.createBookingHold(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: daySlot.startAt,
        endAt: daySlot.endAt,
        guestName: "Booking Proof Link Guest",
        guestPhone: "09171110099",
      },
      websiteUser.id,
    );

    // ============== Before any proof: absent, not an error ==============
    const before = await bookingService.getBookingById(hold.id);
    assert(before, "expected the booking to exist");
    assert(
      before!.paymentProofs.length === 0,
      `expected no proof yet, got ${before!.paymentProofs.length}`,
    );
    console.log("PASS: a booking with no submitted proof shows an empty paymentProofs array.");

    // ============== Pending: shows up immediately ==============
    const proof = await bookingPaymentProofService.submitBookingPaymentProof({
      bookingId: hold.id,
      gcashReference: `BOOKING-PROOF-LINK-${Date.now()}`,
      submittedAmountCents: hold.totalAmountCents!,
      screenshot: {
        fileName: "proof.png",
        contentType: "image/png",
        data: Buffer.from("fake-image-bytes"),
      },
    });

    const pending = await bookingService.getBookingById(hold.id);
    assert(
      pending!.paymentProofs[0]?.id === proof.id,
      "expected the pending proof to surface on the booking",
    );
    assert(
      pending!.paymentProofs[0]?.status === "PENDING",
      `expected PENDING, got ${pending!.paymentProofs[0]?.status}`,
    );
    console.log("PASS: a pending proof surfaces on the booking.");

    // ============== Approved: THE actual bug — still surfaces, not dropped ==============
    await bookingPaymentProofService.approveBookingPaymentProof(proof.id, {
      employeeId: ownerEmployee.id,
      shiftId: shift.id,
      paymentMethodId: gcashMethod.id,
      actorUserId: owner.id,
    });

    const afterApprove = await bookingService.getBookingById(hold.id);
    assert(
      afterApprove!.paymentProofs[0]?.id === proof.id,
      "expected the SAME proof to still surface after approval — this is the reported bug (proof disappearing once approved)",
    );
    assert(
      afterApprove!.paymentProofs[0]?.status === "APPROVED",
      `expected APPROVED, got ${afterApprove!.paymentProofs[0]?.status}`,
    );
    console.log(
      "PASS: an APPROVED proof still surfaces on the booking — no longer disappears once resolved.",
    );

    console.log("\nPASS: booking detail payment-proof link proven against real rows.");
  } finally {
    await cleanUp(court.id);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
