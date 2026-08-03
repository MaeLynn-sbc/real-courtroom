/**
 * BookingService.listBookings' new statusIn filter — backs the Bookings
 * page's Active/Completed/Closed tabs (cancelled bookings were reported
 * live as clutter mixed into the plain day list; grouped tabs hide them
 * without deleting anything — this app never hard-deletes a Booking,
 * see BookingHistory/CoachSession's cascading relations and Sale's
 * non-cascading one). Proves: statusIn scopes results to exactly that
 * status set, and an explicit `status` still wins over `statusIn` when
 * both are present (the Status dropdown filtering within a tab).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { getWebsiteBookingContext } from "./website-identity";

const TEST_DATE = new Date(2031, 3, 11); // Friday, far enough out not to collide with real usage

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
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
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
}

function slot(hour: number) {
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

async function main(): Promise<void> {
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const websiteContext = await getWebsiteBookingContext();
  await cleanUp(court.id);

  const confirmedSlot = slot(9);
  const confirmed = await prisma.booking.create({
    data: {
      bookingReference: `GRPCONF-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "CONFIRMED",
      source: "PUBLIC",
      startAt: confirmedSlot.startAt,
      endAt: confirmedSlot.endAt,
      guestName: "Group Test Confirmed",
      guestPhone: "09170000601",
      totalAmountCents: 35000,
      isAfterHours: false,
    },
  });

  const cancelledSlot = slot(11);
  const cancelled = await prisma.booking.create({
    data: {
      bookingReference: `GRPCANC-${Date.now()}`,
      courtId: court.id,
      bookedById: websiteContext.userId,
      type: "HOURLY",
      status: "CANCELLED",
      source: "PUBLIC",
      startAt: cancelledSlot.startAt,
      endAt: cancelledSlot.endAt,
      guestName: "Group Test Cancelled",
      guestPhone: "09170000602",
      totalAmountCents: 35000,
      isAfterHours: false,
    },
  });

  try {
    // 1. statusIn scopes to exactly that group — the "Active" tab
    // (which includes CONFIRMED) must NOT also surface a CANCELLED row.
    const activeGroup = await bookingService.listBookings({
      date: TEST_DATE,
      statusIn: ["PENDING", "CONFIRMED", "CHECKED_IN", "AWAITING_PAYMENT", "PENDING_VERIFICATION"],
    });
    assert(
      activeGroup.some((b) => b.id === confirmed.id),
      "expected the CONFIRMED booking to appear in the Active group",
    );
    assert(
      !activeGroup.some((b) => b.id === cancelled.id),
      "expected the CANCELLED booking to be excluded from the Active group",
    );
    console.log(
      "PASS: statusIn scopes to exactly its group — Active shows Confirmed, not Cancelled.",
    );

    // 2. The "Closed" tab is the mirror image.
    const closedGroup = await bookingService.listBookings({
      date: TEST_DATE,
      statusIn: ["CANCELLED", "NO_SHOW", "REJECTED", "REFUNDED"],
    });
    assert(
      closedGroup.some((b) => b.id === cancelled.id),
      "expected the CANCELLED booking to appear in the Closed group",
    );
    assert(
      !closedGroup.some((b) => b.id === confirmed.id),
      "expected the CONFIRMED booking to be excluded from the Closed group",
    );
    console.log(
      "PASS: Closed group shows Cancelled, not Confirmed — cancelled bookings are hidden from Active, not deleted.",
    );

    // 3. An explicit `status` wins over `statusIn` — the Status dropdown
    // filtering within a tab still works correctly.
    const explicitStatus = await bookingService.listBookings({
      date: TEST_DATE,
      status: "CONFIRMED",
      statusIn: ["CANCELLED", "NO_SHOW", "REJECTED", "REFUNDED"], // deliberately contradictory
    });
    assert(
      explicitStatus.some((b) => b.id === confirmed.id) && explicitStatus.length === 1,
      "expected the explicit status filter to win over statusIn",
    );
    console.log("PASS: an explicit status filter wins over statusIn.");

    // 4. Nothing was deleted — both rows are still real, queryable
    // Booking rows, exactly what the "hide, don't delete" design promises.
    const stillThere = await prisma.booking.findMany({
      where: { id: { in: [confirmed.id, cancelled.id] } },
    });
    assert(
      stillThere.length === 2,
      "expected both bookings to still exist in the database — nothing was deleted",
    );
    console.log(
      "PASS: cancelled bookings are hidden from the Active tab, not deleted — both rows still exist.",
    );

    await cleanUp(court.id);
  } catch (error) {
    await cleanUp(court.id);
    throw error;
  }

  console.log("\nPASS: booking status-group tabs proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
