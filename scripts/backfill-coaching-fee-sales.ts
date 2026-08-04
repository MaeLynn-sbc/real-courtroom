/**
 * One-time backfill for the Bea Señeris investigation's fix
 * (services/coaching/coach-session-fee-sale.ts): confirmed live against
 * production, 6 real bookings with a non-cancelled coach session and a
 * real Sale, every one recording only the court amount — ₱3,000.00 in
 * coaching fees collected from real customers, never recorded as
 * revenue anywhere. Going forward, approveBookingPaymentProof and
 * settleBooking both record a second Sale (category COACHING)
 * automatically; this catches the bookings that were already paid
 * before that fix landed.
 *
 * Idempotent by construction: scoped to bookings with a non-cancelled
 * coachSession, a real (BOOKING-category) Sale, and NO existing
 * COACHING Sale linked to that same coachSession — a booking already
 * backfilled (or one that went through the live, fixed path) is never
 * revisited on a second run.
 *
 * Run via `npx tsx scripts/backfill-coaching-fee-sales.ts`. Requires
 * the dev database up (or run against production the same way migration
 * scripts in this repo already are — see docs/DEPLOYMENT.md). Prints a
 * report of every booking it touched, and the total amount backfilled —
 * that report is the point of running it, not just a side effect.
 *
 * Each created Sale is backdated to its booking's own court-fee Sale's
 * createdAt (see recordCoachSessionFeeSale's createdAt param), not
 * "now" — the first live run of this script (2026-08-04) missed this,
 * and the ₱2,600 backfilled that day briefly double-counted as part of
 * THAT day's Today's Revenue / shift cash reconciliation instead of the
 * historical days the fees actually belonged to. Corrected same-day.
 *
 * The DB-touching part is exported as backfillCoachingFeeSales() so
 * services/coaching/coach-session-fee-sale-backfill.integration.ts can
 * run it against seeded fixture rows and assert it actually creates the
 * right Sale, categorized and linked correctly — and that a second run
 * creates nothing new.
 */
import "dotenv/config";

import { prisma } from "../lib/prisma";
import { recordCoachSessionFeeSale } from "../services/coaching/coach-session-fee-sale";

export interface CoachingFeeSaleBackfillResult {
  bookingReference: string;
  coachName: string;
  amountCents: number;
}

export async function backfillCoachingFeeSales(): Promise<CoachingFeeSaleBackfillResult[]> {
  const candidates = await prisma.booking.findMany({
    where: {
      coachSession: { status: { not: "CANCELLED" } },
      sale: { isNot: null },
    },
    include: {
      coachSession: { include: { coach: true } },
      sale: {
        select: {
          paymentMethodId: true,
          employeeId: true,
          shiftId: true,
          playerId: true,
          createdAt: true,
        },
      },
    },
  });

  const results: CoachingFeeSaleBackfillResult[] = [];

  for (const booking of candidates) {
    if (!booking.coachSession || !booking.sale) {
      continue; // narrows the include's optionality — always true given the WHERE above
    }
    const alreadyBackfilled = await prisma.sale.findUnique({
      where: { coachSessionId: booking.coachSession.id },
      select: { id: true },
    });
    if (alreadyBackfilled) {
      continue;
    }

    await recordCoachSessionFeeSale({
      coachSessionId: booking.coachSession.id,
      rateCents: booking.coachSession.rateCents,
      paymentMethodId: booking.sale.paymentMethodId,
      employeeId: booking.sale.employeeId,
      shiftId: booking.sale.shiftId,
      playerId: booking.sale.playerId,
      // Backdated to when the court fee's own Sale was created — the
      // real moment the money changed hands — not "now." Otherwise a
      // backfill run today silently inflates today's Total Revenue /
      // Today's Revenue panel and shift cash reconciliation by the whole
      // backfilled amount (reported live, 2026-08-04, on the very first
      // run of this script).
      createdAt: booking.sale.createdAt,
    });
    results.push({
      bookingReference: booking.bookingReference,
      coachName: `${booking.coachSession.coach.firstName} ${booking.coachSession.coach.lastName}`,
      amountCents: booking.coachSession.rateCents,
    });
  }

  return results;
}

async function main(): Promise<void> {
  const results = await backfillCoachingFeeSales();
  const totalCents = results.reduce((sum, r) => sum + r.amountCents, 0);

  if (results.length === 0) {
    console.log("Nothing to backfill — every booking with a coach session already has its coaching Sale recorded.");
  } else {
    console.log(`Backfilled ${results.length} coaching Sale(s):`);
    for (const r of results) {
      console.log(`  ${r.bookingReference} — ${r.coachName} — ₱${(r.amountCents / 100).toFixed(2)}`);
    }
    console.log(`Total backfilled: ₱${(totalCents / 100).toFixed(2)}`);
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
