/**
 * Shift page crash (Nov 2, 2026): Sunday Nov 1 was a closed holiday, but
 * two website GCash payments that day opened its GCash day record, which
 * nobody closed. Monday morning, the Shift page's suggested opening GCash
 * balance tried to open Monday's GCash day, hit "Nov 1 must be closed
 * first", and the whole page errored — Ace couldn't start a shift.
 * Proves against real rows that with yesterday's GCash day left OPEN, the
 * suggestion falls back to the last shift's count instead of throwing.
 *
 * Run via `npm run test:integration`. Requires the dev database up. Skips
 * (exit 0) if today's or yesterday's GCash day already exists, rather than
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

const created: string[] = [];

async function cleanUp(): Promise<void> {
  await prisma.gcashDailyBalance.deleteMany({ where: { id: { in: created } } });
}

async function main(): Promise<void> {
  const { businessDateRolloverHour } = await settingsService.getCourtHours();
  const today = computeBusinessDate(new Date(), businessDateRolloverHour);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const existing = await prisma.gcashDailyBalance.count({ where: { date: { in: [today, yesterday] } } });
  if (existing > 0) {
    console.log("SKIP: today's or yesterday's GCash day already exists in this database.");
    return;
  }

  const openYesterday = await prisma.gcashDailyBalance.create({
    data: { date: yesterday, startingBalanceCents: 100000, status: "OPEN" },
  });
  created.push(openYesterday.id);

  const lastClosed = await prisma.shift.findFirst({
    where: { status: "CLOSED", closingGcashCents: { not: null } },
    orderBy: { endedAt: "desc" },
    select: { closingGcashCents: true },
  });

  const suggested = await shiftService.getSuggestedOpeningGcashCents();
  assert(
    suggested === (lastClosed?.closingGcashCents ?? null),
    `expected the last shift's GCash count (${lastClosed?.closingGcashCents ?? null}), got ${suggested}`,
  );
  const todayRow = await prisma.gcashDailyBalance.findUnique({ where: { date: today } });
  assert(todayRow === null, "today's GCash day must not be opened while yesterday is still open");

  await cleanUp();
  console.log("PASS: an open GCash day yesterday no longer crashes the Shift page.");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await cleanUp().catch(() => undefined);
    await prisma.$disconnect();
    process.exit(1);
  });
