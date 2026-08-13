/**
 * Court booking add-ons (paddle rentals, shop items) — BookingTab.
 * Proves, against real rows:
 *   1. Add-ons can be added and settled even when the booking's own
 *      court-fee Sale already exists (GCash prepay / already settled) —
 *      the two are completely independent.
 *   2. addProductLineItem decrements Product.stockCount atomically, at
 *      add time, not deferred to settlement.
 *   3. settleTab creates a SEPARATE Sale per product — category PRODUCT,
 *      productId set, bookingTabId set — NOT bundled into the booking's
 *      own category-BOOKING Sale, and that Sale is left completely
 *      untouched (same id, same amount, same category, throughout).
 *   4. reportingService.getSalesByProductReport actually picks up the
 *      add-on's Sale — closing the loop on "goes to product sales, not
 *      booking sales," the explicit ask this feature was built for.
 *   5. Voiding a line item before settlement restores the stock it
 *      decremented and nets its amount to zero in the tab total.
 *   6. writeOffTab creates no Sale at all.
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { bookingService } from "./booking.service";
import { bookingTabService } from "./booking-tab.service";
import { reportingService } from "../reporting/reporting.service";
import { settingsService } from "../settings/settings.service";

const TEST_DATE = new Date(2031, 4, 9); // Friday, far enough out not to collide with real usage

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

async function cleanUp(courtId: string, productIds: string[]): Promise<void> {
  const dayStart = new Date(TEST_DATE.getFullYear(), TEST_DATE.getMonth(), TEST_DATE.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const bookings = await prisma.booking.findMany({
    where: { courtId, startAt: { gte: dayStart, lt: dayEnd } },
    select: { id: true },
  });
  const ids = bookings.map((b) => b.id);
  const tabs = await prisma.bookingTab.findMany({
    where: { bookingId: { in: ids } },
    select: { id: true },
  });
  const tabIds = tabs.map((t) => t.id);
  await prisma.sale.deleteMany({
    where: { OR: [{ bookingId: { in: ids } }, { bookingTabId: { in: tabIds } }] },
  });
  await prisma.bookingTabLineItem.deleteMany({ where: { tabId: { in: tabIds } } });
  await prisma.bookingTab.deleteMany({ where: { id: { in: tabIds } } });
  await prisma.bookingHistory.deleteMany({ where: { bookingId: { in: ids } } });
  await prisma.booking.deleteMany({ where: { id: { in: ids } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
}

async function main(): Promise<void> {
  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });
  const court = await prisma.court.findFirstOrThrow({ where: { deletedAt: null } });
  const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: owner.id } });
  const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });

  // Clear any stale rows from a previous failed run BEFORE creating this
  // run's own product — cleanUp deletes by id, so calling it after
  // creating the product would delete the very row this run needs.
  await cleanUp(court.id, []);

  const water = await prisma.product.create({
    data: { name: `Test Water ${Date.now()}`, priceCents: 2500, stockCount: 10, active: true },
  });

  const shift = await prisma.shift.create({
    data: {
      shiftNumber: `SHIFT-ADDONS-${Date.now()}`,
      employeeId: employee.id,
      status: "OPEN",
      openingCashCents: 0,
    },
  });

  try {
    // ============== Setup: a booking that's ALREADY paid for court time ==============
    const bookingSlot = slot(9);
    const booking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: bookingSlot.startAt,
        endAt: bookingSlot.endAt,
        guestName: "Add-ons Test Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    await bookingService.settleBooking(
      booking.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    const courtFeeSale = await prisma.sale.findUniqueOrThrow({ where: { bookingId: booking.id } });
    assert(
      courtFeeSale.category === "BOOKING",
      "expected the court-fee Sale to be category BOOKING",
    );
    console.log(
      "Setup: booking already settled for court time — courtFeeSale exists, category BOOKING.",
    );

    // ============== 1 & 2. Add a product add-on to an already-paid booking ==============
    const stockBefore = water.stockCount;
    const lineItem = await bookingTabService.addProductLineItem(booking.id, water.id, 2, owner.id);
    assert(
      lineItem.amountCents === water.priceCents * 2,
      "expected the line item amount to be priceCents x qty",
    );

    const productAfterAdd = await prisma.product.findUniqueOrThrow({ where: { id: water.id } });
    assert(
      productAfterAdd.stockCount === stockBefore - 2,
      `expected stock to decrement by 2 at ADD time, got ${productAfterAdd.stockCount} (was ${stockBefore})`,
    );
    console.log(
      "PASS: adding a product add-on to an already-settled booking succeeds, and decrements stock immediately.",
    );

    // ============== 5. Void a second line item, restoring stock ==============
    const secondItem = await bookingTabService.addProductLineItem(
      booking.id,
      water.id,
      1,
      owner.id,
    );
    const stockAfterSecondAdd = (
      await prisma.product.findUniqueOrThrow({ where: { id: water.id } })
    ).stockCount;
    await bookingTabService.voidLineItem(booking.id, secondItem.id, "Added by mistake", owner.id);
    const stockAfterVoid = (await prisma.product.findUniqueOrThrow({ where: { id: water.id } }))
      .stockCount;
    assert(
      stockAfterVoid === stockAfterSecondAdd + 1,
      `expected voiding to restore the 1 unit of stock, got ${stockAfterVoid} (was ${stockAfterSecondAdd})`,
    );
    const viewAfterVoid = await bookingTabService.getTabViewByBooking(booking.id);
    assert(viewAfterVoid !== null, "expected a tab to exist");
    assert(
      viewAfterVoid!.totalCents === lineItem.amountCents,
      `expected the voided item to net to zero, leaving only the first line item's amount, got ${viewAfterVoid!.totalCents}`,
    );
    console.log(
      "PASS: voiding a line item restores stock and nets its amount to zero in the tab total.",
    );

    // ============== 3. Settle — separate Sale, court-fee Sale untouched ==============
    const settled = await bookingTabService.settleTab(
      booking.id,
      "CASH",
      null,
      { employeeId: employee.id, shiftId: shift.id, paymentMethodId: cashMethod.id },
      owner.id,
    );
    assert(settled.status === "SETTLED", "expected the tab to be SETTLED");

    const addOnSales = await prisma.sale.findMany({ where: { bookingTabId: settled.id } });
    assert(
      addOnSales.length === 1,
      `expected exactly 1 Sale from settlement (only the un-voided item), got ${addOnSales.length}`,
    );
    assert(
      addOnSales[0].category === "PRODUCT",
      `expected category PRODUCT, got ${addOnSales[0].category}`,
    );
    assert(
      addOnSales[0].productId === water.id,
      "expected productId to be set to the real Product row",
    );
    assert(
      addOnSales[0].bookingId === null,
      "expected the add-on Sale to have NO bookingId — it's not the court fee",
    );
    assert(
      addOnSales[0].amountCents === lineItem.amountCents,
      "expected the Sale amount to match the surviving line item",
    );
    console.log(
      "PASS: settling creates a separate category-PRODUCT Sale, not bundled into the booking's own Sale.",
    );

    const courtFeeSaleAfter = await prisma.sale.findUniqueOrThrow({
      where: { id: courtFeeSale.id },
    });
    assert(
      courtFeeSaleAfter.category === "BOOKING",
      "expected the court-fee Sale to still be category BOOKING",
    );
    assert(
      courtFeeSaleAfter.amountCents === courtFeeSale.amountCents,
      "expected the court-fee Sale amount to be unchanged",
    );
    assert(
      courtFeeSaleAfter.bookingTabId === null,
      "expected the court-fee Sale to have NO bookingTabId",
    );
    console.log(
      "PASS: the booking's own court-fee Sale is completely untouched by settling the add-ons tab.",
    );

    // ============== 4. Sales-by-product report picks it up ==============
    // Range keyed to Sale.createdAt (when the settlement actually ran,
    // i.e. "now") — NOT TEST_DATE, which only backdates the booking's
    // own startAt/endAt to avoid colliding with real court schedules.
    // Real incident: this used to call getSalesByProductReport with no
    // rolloverHour, defaulting to 0 — while the Sale itself gets its
    // businessDate computed with the REAL configured rollover hour (3
    // by default). Any run landing between midnight and the real
    // rollover hour disagreed on which business day "now" belongs to,
    // so the query missed the very Sale this test just created. Same
    // fix, same root cause, as gcash-reconciliation.integration.ts's own
    // comment on this exact class of bug.
    const rolloverHour = (await settingsService.getCourtHours()).businessDateRolloverHour;
    const range = {
      from: new Date(Date.now() - 60 * 60 * 1000),
      to: new Date(Date.now() + 60 * 1000),
    };
    const productReport = await reportingService.getSalesByProductReport(range, rolloverHour);
    const waterRow = productReport.find((row) => row.productName === water.name);
    assert(
      waterRow !== undefined,
      "expected the add-on's Sale to appear on the Sales by Product report",
    );
    assert(
      waterRow!.amountCents === lineItem.amountCents,
      "expected the reported amount to match the add-on Sale",
    );
    console.log(
      "PASS: the add-on's revenue shows up correctly on the Sales by Product report — goes to product sales, not booking sales.",
    );

    await cleanUp(court.id, [water.id]);

    // ============== 6. Write-off creates no Sale ==============
    const woSlot = slot(11);
    const woBooking = await bookingService.createBooking(
      {
        courtId: court.id,
        type: "HOURLY",
        startAt: woSlot.startAt,
        endAt: woSlot.endAt,
        guestName: "Add-ons Writeoff Guest",
      },
      owner.id,
      { employeeId: employee.id, shiftId: shift.id },
    );
    const woWater = await prisma.product.create({
      data: { name: `Test Water WO ${Date.now()}`, priceCents: 2500, stockCount: 10, active: true },
    });
    await bookingTabService.addProductLineItem(woBooking.id, woWater.id, 1, owner.id);
    await bookingTabService.writeOffTab(
      woBooking.id,
      "Comped for a service issue",
      employee.id,
      owner.id,
    );
    const woTab = await prisma.bookingTab.findUniqueOrThrow({ where: { bookingId: woBooking.id } });
    assert(woTab.status === "WRITTEN_OFF", "expected the tab to be WRITTEN_OFF");
    const woSales = await prisma.sale.findMany({ where: { bookingTabId: woTab.id } });
    assert(woSales.length === 0, "expected NO Sale from a write-off — never counted as revenue");
    console.log("PASS: writing off a tab creates no Sale at all.");

    await cleanUp(court.id, [woWater.id]);
  } catch (error) {
    await cleanUp(court.id, [water.id]);
    throw error;
  }

  console.log(
    "\nPASS: booking add-ons proven against real rows — independent settlement, correct stock timing, correct revenue category.",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
