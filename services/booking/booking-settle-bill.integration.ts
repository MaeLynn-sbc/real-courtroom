/**
 * Settle-bill (pay-at-venue gap fix). Proves, against real rows:
 *   1. A staff-created booking (no paymentMethodId) has NO Sale
 *      immediately — the actual gap being fixed: staff used to have to
 *      guess a payment method at booking time, recording revenue
 *      before it was real.
 *   2. settleBooking (CASH) creates the Sale, sets
 *      settledAt/settledByUserId/settledVia, and the amount is counted
 *      by shiftService.getExpectedCashForShift — the same mechanism
 *      any other cash Sale already goes through, no changes needed
 *      there.
 *   3. settleBooking (GCASH) with no reference is rejected.
 *   4. settleBooking (GCASH) with a reference creates the Sale and
 *      persists Booking.gcashReference alongside settledVia.
 *   5. Settling an already-settled booking is rejected
 *      (BookingAlreadySettledError) — proven against a real second
 *      call, not just reasoned about.
 *   6. Regression check: the WEBSITE "pay at venue by default" path
 *      (which still passes paymentMethodId at creation time) is
 *      UNCHANGED — it still gets an immediate Sale, and settleBooking
 *      correctly refuses to settle it again ("already paid").
 *   7. Found live: staff were selecting "Pay at Venue" from the
 *      SETTLE form's payment-method dropdown, reading it as "defer
 *      this," when submitting it creates an immediate real Sale just
 *      like Cash/GCash — recreating the exact bug eb32e21 fixed.
 *      settleBooking must reject an attempt to settle using the
 *      Pay-at-Venue payment method — you can't "settle" a bill with a
 *      method that means "not yet paid." Proven failing-first: this
 *      assertion fails against the pre-fix code (the settle succeeds
 *      and creates a Sale), then passes once the guard is added.
 *   8. Requested live (2026-08-02): an optional receipt/proof-of-
 *      payment photo attached at settle time — persisted as
 *      Booking.receiptStorageKey and retrievable through the same
 *      upload service, so staff can check or recheck what was
 *      collected.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import {
  bookingService,
  BookingAlreadySettledError,
  type CreateBookingSaleContext,
} from "./booking.service";
import { shiftService } from "../shift/shift.service";
import { PAY_AT_VENUE_PAYMENT_METHOD_KEY } from "../../lib/system-identities";
import { getUploadService } from "../upload/upload-service.factory";

const TEST_DATE = new Date(2031, 3, 8); // Tuesday, distinct from booking-source.integration.ts's own fixture date

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
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });

  await cleanUp(court.id);

  // A fresh, isolated OPEN shift for this test's own cash-attribution
  // assertion — reusing whatever shift happened to already be open
  // would contaminate getExpectedCashForShift with unrelated sales.
  const shift = await prisma.shift.create({
    data: {
      shiftNumber: `SHIFT-SETTLEBILL-${Date.now()}`,
      employeeId: employee.id,
      status: "OPEN",
      openingCashCents: 0,
    },
  });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
  const gcashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });

  try {
    // ============== 1. Staff-created booking has NO Sale ==============
    const cashSlot = slot(9);
    const cashBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: cashSlot.startAt,
        endAt: cashSlot.endAt,
        guestName: "Settle Bill Cash Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    const freshlyCreated = await prisma.booking.findUniqueOrThrow({
      where: { id: cashBooking.id },
      include: { sale: true },
    });
    assert(
      freshlyCreated.sale === null,
      "expected a staff-created booking to have NO Sale immediately — that's the actual gap being fixed",
    );
    assert(freshlyCreated.settledAt === null, "expected a freshly-created booking to be unsettled");
    console.log(
      "PASS: a staff-created booking has no Sale and is unsettled immediately after creation.",
    );

    const expectedBeforeSettle = await shiftService.getExpectedCashForShift(shift);
    assert(
      expectedBeforeSettle === shift.openingCashCents,
      "expected cash before settling should just be the opening float — nothing counted yet",
    );

    // ============== 2. settleBooking (CASH) ==============
    const settledCash = await bookingService.settleBooking(
      cashBooking.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    assert(settledCash.settledAt !== null, "expected settledAt to be set after settling");
    assert(
      settledCash.settledByUserId === owner.id,
      "expected settledByUserId to be the settling user",
    );
    assert(settledCash.settledVia === "CASH", "expected settledVia to be CASH");

    const cashSale = await prisma.sale.findUnique({ where: { bookingId: cashBooking.id } });
    assert(cashSale !== null, "expected settleBooking to create a real Sale row");
    assert(
      cashSale!.amountCents === cashBooking.totalAmountCents,
      "expected the Sale amount to match the booking's total",
    );
    console.log("PASS: settleBooking(CASH) creates the Sale and marks the booking settled.");

    const expectedAfterSettle = await shiftService.getExpectedCashForShift(shift);
    assert(
      expectedAfterSettle === expectedBeforeSettle + (cashBooking.totalAmountCents ?? 0),
      `expected cash after settling should include the booking's amount — got ${expectedAfterSettle}, expected ${expectedBeforeSettle + (cashBooking.totalAmountCents ?? 0)}`,
    );
    console.log(
      "PASS: the settled amount is correctly picked up by shift cash reconciliation, at settle time, no changes needed there.",
    );

    // ============== 3. GCASH with no reference is rejected ==============
    const gcashSlot = slot(11);
    const gcashBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: gcashSlot.startAt,
        endAt: gcashSlot.endAt,
        guestName: "Settle Bill GCash Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    let rejectedNoReference = false;
    try {
      await bookingService.settleBooking(
        gcashBooking.id,
        "GCASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: gcashMethod.id },
        owner.id,
      );
    } catch (error) {
      rejectedNoReference = error instanceof Error && error.message.includes("GCash reference");
    }
    assert(rejectedNoReference, "expected settleBooking(GCASH, no reference) to be rejected");
    console.log("PASS: settling via GCash without a reference number is rejected.");

    // ============== 4. GCASH with a reference ==============
    const settledGcash = await bookingService.settleBooking(
      gcashBooking.id,
      "GCASH",
      "GCASH-REF-12345",
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: gcashMethod.id },
      owner.id,
    );
    assert(settledGcash.settledVia === "GCASH", "expected settledVia to be GCASH");
    assert(
      settledGcash.gcashReference === "GCASH-REF-12345",
      "expected the GCash reference to be persisted on the booking",
    );
    console.log(
      "PASS: settleBooking(GCASH) with a reference succeeds and persists the reference on the booking.",
    );

    // ============== 5. Settling an already-settled booking is rejected ==============
    // Found live, proven-failing-first: my first version of this
    // assertion expected BookingAlreadySettledError specifically — it
    // actually throws the earlier, more general "already paid" check
    // instead, because by the time of this SECOND, sequential call, a
    // real Sale already exists (created by the first settleBooking
    // call above) — the precheck.sale guard fires before settledAt
    // ever gets checked. BookingAlreadySettledError is reserved for a
    // genuine concurrent race (two calls both passing the sale-check
    // before either's transaction commits), not this plain
    // call-it-twice case — both guards are real, they just cover
    // different scenarios.
    let rejectedDoubleSettle = false;
    try {
      await bookingService.settleBooking(
        cashBooking.id,
        "CASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
        owner.id,
      );
    } catch (error) {
      rejectedDoubleSettle =
        error instanceof Error && error.message === "This booking is already paid.";
    }
    assert(
      rejectedDoubleSettle,
      "expected settling an already-settled booking to be rejected as already paid",
    );
    const saleCountForCashBooking = await prisma.sale.count({
      where: { bookingId: cashBooking.id },
    });
    assert(
      saleCountForCashBooking === 1,
      "expected exactly one Sale for the cash booking — no duplicate from the rejected re-settle",
    );
    console.log(
      "PASS: settling an already-settled booking is rejected — exactly one Sale exists, no double-billing.",
    );

    // ============== 5b. Genuine concurrent double-settle ==============
    // Two simultaneous settleBooking calls against the SAME fresh
    // unpaid booking — both can pass the precheck.sale check (still
    // null for both, since neither has committed yet), so this is what
    // BookingAlreadySettledError actually guards: the updateMany claim
    // inside the transaction, not the earlier precheck.
    const raceSlot = slot(16);
    const raceBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: raceSlot.startAt,
        endAt: raceSlot.endAt,
        guestName: "Settle Race Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    const raceResults = await Promise.allSettled([
      bookingService.settleBooking(
        raceBooking.id,
        "CASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
        owner.id,
      ),
      bookingService.settleBooking(
        raceBooking.id,
        "CASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
        owner.id,
      ),
    ]);
    const fulfilled = raceResults.filter((r) => r.status === "fulfilled");
    const rejected = raceResults.filter((r) => r.status === "rejected");
    assert(
      fulfilled.length === 1,
      `expected exactly one concurrent settleBooking call to succeed, got ${fulfilled.length}`,
    );
    assert(
      rejected.length === 1,
      `expected exactly one concurrent settleBooking call to be rejected, got ${rejected.length}`,
    );
    const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
    assert(
      rejectionReason instanceof BookingAlreadySettledError,
      `expected the losing concurrent call to throw BookingAlreadySettledError, got ${rejectionReason}`,
    );
    const raceSaleCount = await prisma.sale.count({ where: { bookingId: raceBooking.id } });
    assert(
      raceSaleCount === 1,
      "expected exactly one Sale even under a genuine concurrent double-settle race",
    );
    console.log(
      "PASS: two concurrent settleBooking calls against the same booking resolve to exactly one success — no double-billing under a real race.",
    );

    // ============== 6. Regression: WEBSITE pay-at-venue path unchanged ==============
    const websiteSlot = slot(14);
    const websiteBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: websiteSlot.startAt,
        endAt: websiteSlot.endAt,
        guestName: "Website Guest",
      },
      owner.id,
      {
        employeeId: employee.id,
        shiftId: shift.id,
        paymentMethodId: cashMethod.id,
        source: "WEBSITE",
      } as CreateBookingSaleContext,
    );
    const websiteWithSale = await prisma.booking.findUniqueOrThrow({
      where: { id: websiteBooking.id },
      include: { sale: true },
    });
    assert(
      websiteWithSale.sale !== null,
      "expected the WEBSITE pay-at-venue-by-default path to still get an immediate Sale, unchanged",
    );
    console.log(
      "PASS: the WEBSITE pay-at-venue-by-default path is unchanged — still gets an immediate Sale.",
    );

    let rejectedAlreadyPaid = false;
    try {
      await bookingService.settleBooking(
        websiteBooking.id,
        "CASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
        owner.id,
      );
    } catch (error) {
      rejectedAlreadyPaid =
        error instanceof Error && error.message === "This booking is already paid.";
    }
    assert(
      rejectedAlreadyPaid,
      "expected settleBooking to refuse a booking that already has a Sale from creation time",
    );
    console.log(
      "PASS: settleBooking correctly refuses a booking that's already paid via the WEBSITE creation-time path.",
    );

    // ============== 7. "Pay at Venue" is not a valid SETTLE method ==============
    const payAtVenueMethod = await prisma.paymentMethod.findUniqueOrThrow({
      where: { key: PAY_AT_VENUE_PAYMENT_METHOD_KEY },
    });
    const trapSlot = slot(18);
    const trapBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: trapSlot.startAt,
        endAt: trapSlot.endAt,
        guestName: "Pay At Venue Trap Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    let rejectedPayAtVenue = false;
    try {
      await bookingService.settleBooking(
        trapBooking.id,
        "CASH",
        null,
        { employeeId: employee.id, shiftId: shift.id, paymentMethodId: payAtVenueMethod.id },
        owner.id,
      );
    } catch (error) {
      rejectedPayAtVenue = error instanceof Error && error.message.includes("Pay at Venue");
    }
    assert(
      rejectedPayAtVenue,
      "expected settleBooking to reject an attempt to settle using the Pay-at-Venue payment method",
    );
    const trapSaleCount = await prisma.sale.count({ where: { bookingId: trapBooking.id } });
    assert(
      trapSaleCount === 0,
      "expected NO Sale to exist after a rejected Pay-at-Venue settle attempt",
    );
    const trapBookingAfter = await prisma.booking.findUniqueOrThrow({
      where: { id: trapBooking.id },
    });
    assert(
      trapBookingAfter.settledAt === null,
      "expected the booking to remain unsettled after the rejected attempt",
    );
    console.log(
      "PASS: settleBooking rejects Pay-at-Venue as a settlement method — no Sale created, booking stays unsettled.",
    );

    // ============== 8. Optional receipt attached at settle time ==============
    const receiptSlot = slot(20);
    const receiptBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: receiptSlot.startAt,
        endAt: receiptSlot.endAt,
        guestName: "Receipt Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    const settledWithReceipt = await bookingService.settleBooking(
      receiptBooking.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
      {
        fileName: "receipt.jpg",
        contentType: "image/jpeg",
        data: Buffer.from("fake-receipt-bytes"),
      },
    );
    assert(
      typeof settledWithReceipt.receiptStorageKey === "string" &&
        settledWithReceipt.receiptStorageKey.length > 0,
      "expected receiptStorageKey to be persisted on the booking after settling with a receipt",
    );
    const storedReceipt = await getUploadService().get(settledWithReceipt.receiptStorageKey!);
    assert(
      storedReceipt?.toString() === "fake-receipt-bytes",
      "expected the uploaded receipt bytes to be retrievable via the same storage key",
    );
    console.log(
      "PASS: an optional receipt attached at settle time is uploaded and its key persisted on the booking.",
    );
    await getUploadService().delete(settledWithReceipt.receiptStorageKey!);

    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } });
    console.log(
      "\nPASS: settle-bill proven against real rows — booking payment is now recorded when it actually happens.",
    );
  } catch (error) {
    await cleanUp(court.id);
    await prisma.shift.delete({ where: { id: shift.id } }).catch(() => {});
    throw error;
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
