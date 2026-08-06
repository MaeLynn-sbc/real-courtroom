/**
 * Owner request (2026-08-06): show who CONFIRMED a booking on the staff
 * bookings list, below the Status badge — same "who created" precedent
 * the Source column already has (bookedBy), just for the approval step.
 * listBookings' paymentProofs select gained resolvedByEmployee
 * (firstName/lastName only) alongside the fields it already fetched.
 *
 * Proves, against real rows: an APPROVED proof's resolvedByEmployee comes
 * back correctly on the booking listBookings returns (not just on the
 * proof row fetched directly), and a booking with no resolved proof
 * (still PENDING, or no payment-proof flow at all) comes back with no
 * resolvedByEmployee to show — never a stale or wrong name.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService, type CreateBookingSaleContext } from "./booking.service";
import { bookingPaymentProofService } from "./booking-payment-proof.service";

const TEST_DATE = new Date(2031, 5, 23); // Monday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

function slot(hour: number): { startAt: Date; endAt: Date } {
  const startAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour, 0);
  const endAt = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate(), hour + 1, 0);
  return { startAt, endAt };
}

function screenshot() {
  return { fileName: "proof.png", contentType: "image/png", data: Buffer.from("fake-image-bytes") };
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
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: "website@thecourtroom.local" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const ownerEmployee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  let shift = await prisma.shift.findFirst({ where: { employeeId: ownerEmployee.id, status: "OPEN" } });
  if (!shift) {
    shift = await prisma.shift.create({
      data: { shiftNumber: `SHIFT-RESOLVEDBY-${Date.now()}`, employeeId: ownerEmployee.id, status: "OPEN" },
    });
  }
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  await cleanUp(court.id);

  // --- Case 1: an APPROVED proof's resolver shows up on listBookings ---
  const approvedSlot = slot(9);
  const holdA = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: approvedSlot.startAt, endAt: approvedSlot.endAt, guestName: "Resolved By Guest A", guestPhone: "09171110040" },
    websiteUser.id,
  );
  const proofA = await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdA.id,
    gcashReference: `RESOLVEDBY-A-${Date.now()}`,
    submittedAmountCents: holdA.totalAmountCents!,
    screenshot: screenshot(),
  });
  await bookingPaymentProofService.approveBookingPaymentProof(proofA.id, {
    employeeId: ownerEmployee.id,
    shiftId: shift.id,
    paymentMethodId: gcashMethod.id,
    actorUserId: owner.id,
  });

  // --- Case 2: a still-PENDING proof has no resolver yet ---
  const pendingSlot = slot(11);
  const holdB = await bookingService.createBookingHold(
    { courtId: court.id, type: "HOURLY", startAt: pendingSlot.startAt, endAt: pendingSlot.endAt, guestName: "Resolved By Guest B", guestPhone: "09171110041" },
    websiteUser.id,
  );
  await bookingPaymentProofService.submitBookingPaymentProof({
    bookingId: holdB.id,
    gcashReference: `RESOLVEDBY-B-${Date.now()}`,
    submittedAmountCents: holdB.totalAmountCents!,
    screenshot: screenshot(),
  });

  // --- Case 3: a staff booking has no payment-proof flow at all ---
  const staffSlot = slot(13);
  const staffBooking = await bookingService.createBooking(
    { courtId: court.id, type: "HOURLY", startAt: staffSlot.startAt, endAt: staffSlot.endAt, guestName: "Resolved By Staff Guest" },
    owner.id,
    { employeeId: ownerEmployee.id, shiftId: shift.id, paymentMethodId: gcashMethod.id } as CreateBookingSaleContext,
  );

  const rows = await bookingService.listBookings({ date: TEST_DATE, courtId: court.id });
  const rowA = rows.find((r) => r.id === holdA.id);
  const rowB = rows.find((r) => r.id === holdB.id);
  const rowC = rows.find((r) => r.id === staffBooking.id);

  assert(rowA !== undefined, "expected the approved booking to appear in listBookings");
  assert(rowA!.paymentProofs[0]?.status === "APPROVED", `expected an APPROVED proof, got ${rowA!.paymentProofs[0]?.status}`);
  assert(
    rowA!.paymentProofs[0]?.resolvedByEmployee?.firstName === ownerEmployee.firstName &&
      rowA!.paymentProofs[0]?.resolvedByEmployee?.lastName === ownerEmployee.lastName,
    `expected resolvedByEmployee to be the approving employee (${ownerEmployee.firstName} ${ownerEmployee.lastName}), got ${JSON.stringify(rowA!.paymentProofs[0]?.resolvedByEmployee)}`,
  );
  console.log(`PASS: listBookings surfaces the approving employee (${ownerEmployee.firstName} ${ownerEmployee.lastName}) on an APPROVED proof.`);

  assert(rowB !== undefined, "expected the pending booking to appear in listBookings");
  assert(rowB!.paymentProofs[0]?.status === "PENDING", `expected a PENDING proof, got ${rowB!.paymentProofs[0]?.status}`);
  assert(rowB!.paymentProofs[0]?.resolvedByEmployee == null, "expected no resolvedByEmployee on a still-PENDING proof");
  console.log("PASS: a still-PENDING proof has no resolver — nothing to show yet.");

  assert(rowC !== undefined, "expected the staff booking to appear in listBookings");
  assert(rowC!.paymentProofs.length === 0, "expected a staff booking to have no payment proofs at all — no payment-proof flow, so nothing to show");
  console.log("PASS: a staff-created booking (no payment-proof flow) has no resolver to show — correctly absent, not a stale value.");

  await cleanUp(court.id);
  console.log("\nPASS: 'who confirmed' data proven correct on listBookings against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
