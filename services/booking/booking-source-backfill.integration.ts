/**
 * Proves scripts/backfill-booking-source.ts's branching logic against real
 * rows, not just resolveBookingSource in isolation (booking-source.test.ts)
 * or the creation-time path (booking-source.integration.ts). The one live
 * run of the backfill against the dev DB found 0 UNKNOWN rows to process,
 * so the agree/disagree/unresolvable branching was never actually
 * exercised end-to-end — this seeds four historical-shaped fixture rows
 * (source: "UNKNOWN", bypassing createBooking entirely, the way real
 * pre-migration rows looked) covering all four outcomes and runs the real
 * backfillBookingSource() against them.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { backfillBookingSource } from "../../scripts/backfill-booking-source";
import { WEBSITE_SYSTEM_USER_EMAIL } from "../../lib/system-identities";

const TEST_DATE = new Date(2031, 3, 9); // Wednesday, far enough out not to collide with real usage

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
  const websiteUser = await prisma.user.findFirstOrThrow({ where: { email: WEBSITE_SYSTEM_USER_EMAIL } });
  const staffUser = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: staffUser.id } });
  const existingShift = await prisma.shift.findFirst({ where: { employeeId: employee.id, status: "OPEN" } });
  const shift =
    existingShift ??
    (await prisma.shift.create({ data: { shiftNumber: `SHIFT-BACKFILL-${Date.now()}`, employeeId: employee.id, status: "OPEN" } }));
  const paymentMethod = await prisma.paymentMethod.findFirstOrThrow({ where: { isActive: true } });

  await cleanUp(court.id);

  // Raw inserts, bypassing bookingService.createBooking entirely — that's
  // the point: these fixtures simulate rows written before Booking.source
  // existed, which is exactly what the migration's DEFAULT UNKNOWN and
  // this script's WHERE source = 'UNKNOWN' scope target.
  async function createFixture(
    hour: number,
    label: string,
    bookedById: string,
    saleSource: "WEBSITE" | "RECEPTION" | null,
  ): Promise<string> {
    const { startAt, endAt } = slot(hour);
    const booking = await prisma.booking.create({
      data: {
        bookingReference: `TCR-BACKFILL-${label}-${Date.now()}`,
        courtId: court.id,
        bookedById,
        type: "HOURLY",
        status: "CONFIRMED",
        source: "UNKNOWN",
        startAt,
        endAt,
        guestName: `Backfill Fixture ${label}`,
      },
    });
    if (saleSource !== null) {
      await prisma.sale.create({
        data: {
          saleNumber: `SALE-BACKFILL-${label}-${Date.now()}`,
          category: "BOOKING",
          source: saleSource,
          amountCents: 40000,
          paymentMethodId: paymentMethod.id,
          employeeId: employee.id,
          shiftId: shift.id,
          bookingId: booking.id,
        },
      });
    }
    return booking.id;
  }

  // (a) Sale.source and bookedById agree on PUBLIC.
  const agreePublicId = await createFixture(9, "AgreePublic", websiteUser.id, "WEBSITE");
  // (b) Sale.source and bookedById agree on STAFF.
  const agreeStaffId = await createFixture(10, "AgreeStaff", staffUser.id, "RECEPTION");
  // (c) Disagreement: Sale says WEBSITE, bookedBy is a real staff user.
  const disagreeId = await createFixture(11, "Disagree", staffUser.id, "WEBSITE");
  // (d) Neither resolvable: no linked Sale at all.
  const noSaleId = await createFixture(12, "NoSale", staffUser.id, null);

  const counts = await backfillBookingSource();
  console.log(
    `Backfill bucket counts (fixture run): PUBLIC: ${counts.PUBLIC}, STAFF: ${counts.STAFF}, UNKNOWN: ${counts.UNKNOWN}`,
  );

  const [agreePublic, agreeStaff, disagree, noSale] = await Promise.all([
    prisma.booking.findUniqueOrThrow({ where: { id: agreePublicId } }),
    prisma.booking.findUniqueOrThrow({ where: { id: agreeStaffId } }),
    prisma.booking.findUniqueOrThrow({ where: { id: disagreeId } }),
    prisma.booking.findUniqueOrThrow({ where: { id: noSaleId } }),
  ]);

  assert(agreePublic.source === "PUBLIC", `expected the Sale=WEBSITE/bookedBy=website-identity fixture to resolve PUBLIC, got ${agreePublic.source}`);
  assert(agreeStaff.source === "STAFF", `expected the Sale=RECEPTION/bookedBy=staff fixture to resolve STAFF, got ${agreeStaff.source}`);
  assert(disagree.source === "UNKNOWN", `expected the Sale=WEBSITE/bookedBy=staff (disagreeing) fixture to stay UNKNOWN, got ${disagree.source}`);
  assert(noSale.source === "UNKNOWN", `expected the no-Sale-linked fixture to stay UNKNOWN, got ${noSale.source}`);
  console.log("PASS: each fixture landed in its correct bucket — agree resolves, disagree and unresolvable both stay UNKNOWN.");

  assert(counts.PUBLIC === 1, `expected exactly 1 PUBLIC in this run's bucket counts, got ${counts.PUBLIC}`);
  assert(counts.STAFF === 1, `expected exactly 1 STAFF in this run's bucket counts, got ${counts.STAFF}`);
  assert(counts.UNKNOWN === 2, `expected exactly 2 UNKNOWN in this run's bucket counts, got ${counts.UNKNOWN}`);
  console.log("PASS: reported bucket counts (PUBLIC: 1, STAFF: 1, UNKNOWN: 2) match the four fixtures exactly.");

  await cleanUp(court.id);
  console.log("PASS: backfillBookingSource's agree/disagree/unresolvable branching is proven against real rows, not just the pure function in isolation.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
