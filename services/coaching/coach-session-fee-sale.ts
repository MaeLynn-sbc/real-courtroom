import type { Prisma, Sale } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
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
      amountCents: input.rateCents,
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
