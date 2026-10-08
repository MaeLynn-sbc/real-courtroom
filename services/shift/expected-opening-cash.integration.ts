/**
 * Expected opening cash (owner, 2026-10-09): Wednesday's ₱4,200 collection
 * was entered as ₱3,200, and the ₱1,005 gap only surfaced at Thursday's
 * day-end close. shiftService.getExpectedOpeningCashCents is what the
 * start-shift form now compares the opening count against. Replays that
 * week against real rows, on today's real business date:
 *   1. First shift of the day: yesterday's count minus its withdrawal.
 *   2. Mid-day handover: the shift that just closed, as counted.
 *   3. After the night close: today's count minus today's withdrawal.
 *
 * Run via `npm run test:integration`. Requires the dev database up. Skips
 * (exit 0) if today's or yesterday's cash day already exists, rather than
 * touching real dev data.
 */
import "dotenv/config";

import { computeBusinessDate } from "../../lib/business-date";
import { prisma } from "../../lib/prisma";
import { settingsService } from "../settings/settings.service";
import { shiftService } from "./shift.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

const created = { balances: [] as string[], shifts: [] as string[] };

async function cleanUp(): Promise<void> {
  await prisma.shift.deleteMany({ where: { id: { in: created.shifts } } });
  await prisma.cashDailyBalance.deleteMany({ where: { id: { in: created.balances } } });
}

async function main(): Promise<void> {
  const { businessDateRolloverHour } = await settingsService.getCourtHours();
  const today = computeBusinessDate(new Date(), businessDateRolloverHour);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const existing = await prisma.cashDailyBalance.count({ where: { date: { in: [today, yesterday] } } });
  const laterClosedShift = await prisma.shift.count({ where: { status: "CLOSED", endedAt: { gte: yesterday } } });
  if (existing > 0 || laterClosedShift > 0) {
    console.log("SKIP: today's or yesterday's cash day (or a recent closed shift) already exists in this database.");
    return;
  }

  const employee = await prisma.employee.findFirstOrThrow({ where: { user: { username: "owner" } } });

  // Wednesday: counted ₱4,881, withdrawal entered as ₱3,200.
  const wednesday = await prisma.cashDailyBalance.create({
    data: {
      date: yesterday,
      startingBalanceCents: 55100,
      expectedEndingBalanceCents: 488100,
      confirmedEndingBalanceCents: 488100,
      withdrawnCents: 320000,
      varianceCents: 0,
      status: "CONFIRMED",
      confirmedAt: new Date(yesterday.getTime() + 23 * 3600_000),
    },
  });
  created.balances.push(wednesday.id);

  // 1. Thursday's first shift should open with ₱1,681 — not the ₱676 counted.
  const firstExpected = await shiftService.getExpectedOpeningCashCents();
  const todayRow = await prisma.cashDailyBalance.findUnique({ where: { date: today } });
  if (todayRow) created.balances.push(todayRow.id);
  assert(firstExpected !== null, "expected a value for the first shift of the day");
  assert(
    firstExpected >= 168100,
    `first shift: expected at least ₱1,681 (yesterday's count minus withdrawal), got ${firstExpected}`,
  );
  console.log("PASS: first shift of the day expects yesterday's count minus its withdrawal (₱1,681 for this week).");

  // 2. Mid-day handover: the morning shift closed with ₱1,096.
  const morning = await prisma.shift.create({
    data: {
      shiftNumber: `TEST-EXPECTED-OPENING-${Date.now()}`,
      employeeId: employee.id,
      status: "CLOSED",
      openingCashCents: 67600,
      closingCashCents: 109600,
      startedAt: new Date(Date.now() - 2 * 3600_000),
      endedAt: new Date(Date.now() - 60_000),
    },
  });
  created.shifts.push(morning.id);
  assert(
    (await shiftService.getExpectedOpeningCashCents()) === 109600,
    "mid-day handover: expected the closing count of the shift that just ended",
  );
  console.log("PASS: a mid-day handover expects the previous shift's own closing count.");

  // Same root cause, found alongside: the Shift Reconciliation report's
  // NOT-startsWith filter dropped every shift with no opening note.
  const report = await shiftService.getShiftReconciliationReport(
    { from: today, to: new Date(today.getTime() + 24 * 3600_000 - 1) },
    businessDateRolloverHour,
  );
  assert(
    report.some((row) => row.shiftNumber === morning.shiftNumber),
    "shift reconciliation report: expected a shift with no opening note to be listed",
  );
  console.log("PASS: the Shift Reconciliation report lists shifts that have no opening note.");

  // 3. Night close confirmed: counted ₱2,026, withdrew ₱1,000.
  await prisma.cashDailyBalance.update({
    where: { date: today },
    data: {
      status: "CONFIRMED",
      expectedEndingBalanceCents: 202600,
      confirmedEndingBalanceCents: 202600,
      withdrawnCents: 100000,
      varianceCents: 0,
      confirmedAt: new Date(),
    },
  });
  assert(
    (await shiftService.getExpectedOpeningCashCents()) === 102600,
    "after the night close: expected today's count minus today's withdrawal",
  );
  console.log("PASS: a shift opening after the night close expects the count minus the withdrawal (₱1,026).");

  await cleanUp();
  console.log("\nPASS: expected opening cash proven against real rows.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
