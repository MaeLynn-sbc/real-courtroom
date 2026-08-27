/**
 * Backfills AttendanceRecord from closed Shift rows.
 *
 * Owner incident (2026-08-26): payroll showed PHP 0.00 and NO_ATTENDANCE
 * for every day from 2026-08-15 onward. The owner was sure staff had been
 * there — they had. 22 closed Shift rows carried their real start/end
 * times the whole time (Dani Ace 07:40-15:19 on the 17th, and so on),
 * while AttendanceRecord had not been written to since a one-off backfill
 * on Aug 14. Two tables recording the same human fact, only one of them
 * wired to pay.
 *
 * shiftService.endShift now seeds attendance automatically, so this gap
 * cannot reopen. This recovers the days that were missed before that
 * existed.
 *
 * Goes through attendanceRecordService.seedFromShift rather than writing
 * rows directly, so every guard applies: clockOut > clockIn, the overlap
 * check, business-date derivation via the stored rollover hour, and the
 * audit log. It is idempotent on shiftId — a re-run creates nothing new,
 * and a manually-entered record already covering those hours is left
 * authoritative rather than duplicated.
 *
 * Committed per scripts/README.md's convention: a script that writes to
 * production gets committed BEFORE it is run, even if it runs once.
 *
 * Usage (dry run first, always):
 *   npx tsx scripts/backfill-attendance-from-shifts.ts --since=2026-08-15
 *   npx tsx scripts/backfill-attendance-from-shifts.ts --since=2026-08-15 --apply
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { attendanceRecordService } from "../services/payroll/attendance-record.service";

// Flagged, not skipped. A shift this long is usually a forgotten close
// rather than a real day, and seeding it turns those hours into paid
// overtime — so it is surfaced for a human to confirm rather than
// silently paid or silently dropped.
const LONG_SHIFT_HOURS = 12;

function parseArgs() {
  const args = process.argv.slice(2);
  const since = args.find((a) => a.startsWith("--since="))?.split("=")[1];
  return { since, apply: args.includes("--apply") };
}

async function main(): Promise<void> {
  const { since, apply } = parseArgs();
  if (!since) {
    console.error("Refusing to run without --since=YYYY-MM-DD (bounds what this touches).");
    process.exit(1);
  }
  const sinceDate = new Date(`${since}T00:00:00`);
  if (Number.isNaN(sinceDate.getTime())) {
    console.error(`Invalid --since date: ${since}`);
    process.exit(1);
  }

  const owner = await prisma.user.findFirstOrThrow({ where: { username: "owner" } });

  const shifts = await prisma.shift.findMany({
    where: { status: "CLOSED", endedAt: { not: null }, startedAt: { gte: sinceDate } },
    include: { employee: { select: { firstName: true, lastName: true } } },
    orderBy: { startedAt: "asc" },
  });

  console.log(`${apply ? "APPLYING" : "DRY RUN"} — ${shifts.length} closed shift(s) since ${since}\n`);

  let created = 0;
  let skipped = 0;
  const longOnes: string[] = [];

  for (const shift of shifts) {
    const who = `${shift.employee.firstName} ${shift.employee.lastName}`.trim();
    // Local (TZ=Asia/Manila on the droplet), NOT toISOString — that is
    // always UTC and printed a date one day behind the Manila time beside
    // it, which reads as though a shift landed on the wrong day. Display
    // only; the stored workDate was always derived correctly via
    // computeBusinessDate.
    const day = `${shift.startedAt.getFullYear()}-${String(shift.startedAt.getMonth() + 1).padStart(2, "0")}-${String(shift.startedAt.getDate()).padStart(2, "0")}`;
    const window = `${shift.startedAt.toTimeString().slice(0, 5)}-${shift.endedAt!.toTimeString().slice(0, 5)}`;
    const hours = (shift.endedAt!.getTime() - shift.startedAt.getTime()) / 3_600_000;
    const long = hours >= LONG_SHIFT_HOURS;
    if (long) {
      longOnes.push(`${day}  ${who.padEnd(22)} ${window}  ${hours.toFixed(1)}h`);
    }

    const existing = await prisma.attendanceRecord.findFirst({ where: { shiftId: shift.id } });
    if (existing) {
      skipped += 1;
      console.log(`  skip    ${day}  ${who.padEnd(22)} ${window}  (already seeded)`);
      continue;
    }

    if (!apply) {
      console.log(`  would  ${day}  ${who.padEnd(22)} ${window}  ${hours.toFixed(1)}h${long ? "  <-- LONG" : ""}`);
      created += 1;
      continue;
    }

    const record = await attendanceRecordService.seedFromShift(shift, owner.id);
    if (record) {
      created += 1;
      console.log(`  created ${day}  ${who.padEnd(22)} ${window}  ${hours.toFixed(1)}h${long ? "  <-- LONG" : ""}`);
    } else {
      skipped += 1;
      console.log(`  skip    ${day}  ${who.padEnd(22)} ${window}  (overlaps an existing record)`);
    }
  }

  console.log(
    `\n${apply ? "Created" : "Would create"}: ${created}   Skipped: ${skipped}   Total shifts: ${shifts.length}`,
  );

  if (longOnes.length > 0) {
    console.log(`\n⚠ ${longOnes.length} shift(s) of ${LONG_SHIFT_HOURS}h or more — confirm these are real days,`);
    console.log("  not forgotten closes. Seeding them pays the extra hours as overtime:");
    for (const line of longOnes) {
      console.log(`    ${line}`);
    }
    console.log("  Correct any of them afterwards in the payroll attendance workspace.");
  }

  if (!apply) {
    console.log("\nNothing was written. Re-run with --apply to commit.");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
