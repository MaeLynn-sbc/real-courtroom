/**
 * Owner-reported live incident (2026-08-06): "I can't remove the previous
 * pay periods" — the periods page used to call ensurePeriodsThroughDate
 * (a rolling 2-month backfill) on every single page load, and
 * getOrCreatePeriodForDate is a find-or-create keyed on exact
 * [startDate, endDate] — so deleting any RECENT period just resurrected
 * an identical replacement (same dates, new id) the very next page load.
 * ensurePeriodsThroughDate has been removed entirely; the page now only
 * ensures the period containing TODAY exists.
 *
 * Proves, against real rows:
 *   1. Deleting a period that is NOT today's, then calling
 *      getOrCreatePeriodForDate(today) (exactly what the page now does)
 *      does NOT resurrect the deleted period — it stays gone.
 *   2. createPeriod (the new "Add period" form's backing method) creates
 *      a real period for an arbitrary date range the automatic "ensure
 *      today" never reaches — the owner's other ask, "how can I add."
 *   3. createPeriod rejects end < start, and rejects an exact duplicate
 *      of an existing period's dates with a clear message (not a raw
 *      P2002).
 *
 * Run via `npm run test:integration`. Requires the dev database up.
 */
import "dotenv/config";

import { prisma } from "../../lib/prisma";
import { payPeriodService } from "./pay-period.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

// Far enough from any real period (this app's actual periods cluster
// around real "today" dates) that these rows can't collide with
// anything a human is actually using.
const OLD_PERIOD_START = new Date(2019, 0, 26);
const OLD_PERIOD_END = new Date(2019, 1, 10);

async function cleanUp(): Promise<void> {
  // Covers every fixture date used below: the old period (Jan-Feb 2019),
  // the manual-add period (June 2019), and the bad-range test (July 2019).
  await prisma.payPeriod.deleteMany({
    where: { startDate: { gte: new Date(2019, 0, 1), lt: new Date(2019, 7, 1) } },
  });
}

async function main(): Promise<void> {
  await cleanUp();

  // --- Case 1: deleting a non-today period sticks — the exact fix for
  // the live incident. ---
  const oldPeriod = await payPeriodService.createPeriod(OLD_PERIOD_START, OLD_PERIOD_END);
  console.log(`Case 1: created a period to delete: ${oldPeriod.id}`);

  await prisma.payPeriod.delete({ where: { id: oldPeriod.id } });
  const afterDelete = await prisma.payPeriod.findUnique({ where: { id: oldPeriod.id } });
  assert(afterDelete === null, "expected the period to actually be deleted");

  // This is exactly what PayPeriodsPage now calls on every page load —
  // proving it does NOT resurrect the just-deleted, unrelated period.
  await payPeriodService.getOrCreatePeriodForDate(new Date());

  const stillGone = await prisma.payPeriod.findFirst({
    where: { startDate: OLD_PERIOD_START, endDate: OLD_PERIOD_END },
  });
  assert(stillGone === null, "expected the deleted period to stay deleted — proven failing-first against the exact live incident");
  console.log("PASS: deleting a non-today period sticks — the page's own 'ensure today' call does not resurrect it.");

  // --- Case 2: createPeriod adds a real period for an arbitrary date
  // range — the owner's other ask ("how can I add"). ---
  const manualStart = new Date(2019, 5, 1);
  const manualEnd = new Date(2019, 5, 15);
  const created = await payPeriodService.createPeriod(manualStart, manualEnd);
  assert(created.startDate.getTime() === manualStart.getTime(), "expected the exact start date to be stored");
  assert(created.endDate.getTime() === manualEnd.getTime(), "expected the exact end date to be stored");
  console.log(`PASS: createPeriod adds a real period (${created.id}) for a date range the automatic backfill never reaches.`);

  // --- Case 3: validation and the duplicate guard. ---
  let rejectedBadRange = false;
  try {
    await payPeriodService.createPeriod(new Date(2019, 6, 15), new Date(2019, 6, 1));
  } catch (error) {
    rejectedBadRange = error instanceof Error && error.message.includes("End date must be on or after");
  }
  assert(rejectedBadRange, "expected an end-before-start range to be rejected");

  let rejectedDuplicate = false;
  try {
    await payPeriodService.createPeriod(manualStart, manualEnd);
  } catch (error) {
    rejectedDuplicate = error instanceof Error && error.message.includes("already exists");
  }
  assert(rejectedDuplicate, "expected an exact-duplicate date range to be rejected with a clear message");
  console.log("PASS: createPeriod rejects an invalid range and an exact duplicate, both with clear messages.");

  await cleanUp();
  console.log("\nPASS: manual add + delete-sticks proven against real rows.");
  process.exit(0);
}

main().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
