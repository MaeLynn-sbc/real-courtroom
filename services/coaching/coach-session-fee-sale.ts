import type { Prisma, Sale } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { coachingFeeCents } from "@/lib/booking-payment-total";
import { saleService } from "@/services/sales/sale.service";

// Owner decision 2026-08-04 (the Bea Señeris investigation): a coach's
// session fee gets its own Sale, category COACHING, linked via
// Sale.coachSessionId — both already existed in the schema, reserved
// and unused since coaching sessions first launched ("nothing creates a
// Sale with this category yet," that field's own comment said), and
// reporting.service.ts already queries category COACHING for its
// coaching-revenue figure. Same combined GCash/cash payment as the
// court fee, just split into two Sale rows instead of one — the coach's
// fee is real revenue through the books now, tracked separately from
// court hire so a "how much coaching revenue, per coach" report is
// possible. Paying the coach their share afterward is a separate,
// manual step the owner does themselves (an Expense, entered by hand
// when the payout actually happens) — nothing here creates one
// automatically.
//
// Created INSIDE the same transaction as the booking's own court Sale,
// not after commit — both are real Sale rows and must land atomically
// together, unlike a best-effort side effect (SMS, audit log).
export interface RecordCoachSessionFeeSaleInput {
  coachSessionId: string;
  rateCents: number;
  /** Hours purchased. rateCents is HOURLY — see coachingFeeCents. */
  hours: number;
  paymentMethodId: string;
  employeeId: string;
  shiftId: string;
  playerId?: string | null;
  // Backfill-only — see CreateSaleInput.createdAt's own comment. Live
  // callers (approveBookingPaymentProof, settleBooking) never set this,
  // so they still get the real current moment.
  createdAt?: Date;
}

export async function recordCoachSessionFeeSale(
  input: RecordCoachSessionFeeSaleInput,
  tx: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<Sale> {
  return saleService.createSale(
    {
      category: "COACHING",
      // NOT input.rateCents. rateCents is the HOURLY rate; the Sale must
      // record what was actually charged. Goes through coachingFeeCents
      // so this agrees with getExpectedPaymentTotalCents by
      // construction — if the Sale and the expected total ever disagree,
      // approveBookingPaymentProof rejects a payment that was correct.
      amountCents: coachingFeeCents({ rateCents: input.rateCents, hours: input.hours }),
      paymentMethodId: input.paymentMethodId,
      employeeId: input.employeeId,
      shiftId: input.shiftId,
      playerId: input.playerId ?? undefined,
      coachSessionId: input.coachSessionId,
      createdAt: input.createdAt,
    },
    tx,
  );
}
