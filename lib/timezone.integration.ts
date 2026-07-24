/**
 * BUILD-SPEC.md §0 "Timezone: date-only values assume TZ=Asia/Manila."
 * Regression test for the bug this migration chain exists to prevent:
 * this app builds date-only values as JS local-timezone midnight, and a
 * hand-written Postgres CHECK constraint (prisma/migrations/
 * 12_fix_registration_weekday_check_timezone/) assumes that construction
 * always means PH-local midnight, extracting day-of-week from
 * `date + INTERVAL '8 hours'`. If the process timezone ever drifts from
 * Asia/Manila, JS and the database will disagree about what day a
 * "Friday" row actually is — this test proves they agree, not just that
 * lib/env.ts's boot assertion ran.
 *
 * Run via `npm run test:integration` (see run-integration-tests.ts).
 */
import "dotenv/config";

import { prisma } from "./prisma";
import { openPlayCapacityService } from "../services/open-play/open-play-capacity.service";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
}

async function main() {
  const offset = new Date().getTimezoneOffset();
  assert(offset === -480, `process must run at UTC+8 (Asia/Manila) for this test to be meaningful — got offset ${offset}`);

  const upcoming = await openPlayCapacityService.getUpcomingNights(14);
  const friday = upcoming.find((n) => n.dayOfWeek === 5)?.date;
  assert(friday, "expected an upcoming Friday within 14 days");
  assert(friday!.getDay() === 5, "JS's own Date.getDay() must agree this is a Friday");

  // Write it — materializes an OpenPlayNightSession row for this date.
  // getOrCreateSessionForDate returns an existing row if one's already
  // there (real usage may have created one for this same Friday) — only
  // clean up if this test is the one that created it.
  const preExisting = await prisma.openPlayNightSession.findUnique({ where: { date: friday! } });
  const session = await openPlayCapacityService.getOrCreateSessionForDate(friday!);

  try {
    // Read it back via the exact expression migration 12 uses, and
    // confirm the database agrees it's a Friday (5) — not Thursday (4),
    // which is what the pre-migration-12 bug produced.
    const rows = await prisma.$queryRaw<{ dow: number }[]>`
      SELECT EXTRACT(DOW FROM date + INTERVAL '8 hours') as dow
      FROM "OpenPlayNightSession"
      WHERE id = ${session.id}
    `;
    const dbDayOfWeek = Number(rows[0]?.dow);
    assert(dbDayOfWeek === 5, `database must agree this row is a Friday (dow=5) — got dow=${dbDayOfWeek}`);

    console.log("PASS: JS and the database agree a constructed Friday date is a Friday, round-tripped through Postgres.");
  } finally {
    if (!preExisting) {
      await prisma.openPlayNightSession.delete({ where: { id: session.id } });
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
