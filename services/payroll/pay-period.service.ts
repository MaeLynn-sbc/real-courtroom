import type { PayPeriod } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Same structural check duplicated across several services (see
// gcash-reconciliation.service.ts, cash-reconciliation.service.ts,
// booking-payment-proof.service.ts) rather than importing
// PrismaClientKnownRequestError from the generated client.
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Semi-monthly (1st-15th, 16th-end of month), owner-confirmed cadence. Pure
// and directly unit-testable — no Prisma import.
export function computeSemiMonthlyPeriodBounds(date: Date): { startDate: Date; endDate: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  return date.getDate() <= 15
    ? { startDate: new Date(year, month, 1), endDate: new Date(year, month, 15) }
    : { startDate: new Date(year, month, 16), endDate: new Date(year, month + 1, 0) };
}

// Payroll Batch 2b. Lazy, on-demand generation — mirrors
// gcashReconciliationService.getOrCreateBalanceForDate's shape (findUnique,
// then create with a P2002-retry for the benign concurrent-first-call
// race), except a PayPeriod carries no forward-dependent state (no
// "starting balance carried from yesterday"), so there's no correctness
// reason to pre-generate a year of these upfront — just less pressing than
// it was there.
export class PayPeriodService {
  async getOrCreatePeriodForDate(date: Date): Promise<PayPeriod> {
    const { startDate, endDate } = computeSemiMonthlyPeriodBounds(date);

    const existing = await prisma.payPeriod.findUnique({
      where: { startDate_endDate: { startDate, endDate } },
    });
    if (existing) {
      return existing;
    }

    try {
      return await prisma.payPeriod.create({ data: { startDate, endDate } });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return prisma.payPeriod.findUniqueOrThrow({
          where: { startDate_endDate: { startDate, endDate } },
        });
      }
      throw error;
    }
  }

  // Ensures every period from the earliest requested date through
  // throughDate exists, so a periods-list page always shows the current +
  // recent periods with no manual "create period" step anywhere in the UI.
  async ensurePeriodsThroughDate(throughDate: Date, monthsBack = 2): Promise<void> {
    const start = new Date(throughDate.getFullYear(), throughDate.getMonth() - monthsBack, 1);
    let cursor = start;
    while (cursor <= throughDate) {
      await this.getOrCreatePeriodForDate(cursor);
      const { endDate } = computeSemiMonthlyPeriodBounds(cursor);
      cursor = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
    }
  }

  async listPeriods(): Promise<PayPeriod[]> {
    return prisma.payPeriod.findMany({ orderBy: { startDate: "desc" } });
  }

  async getPeriodById(periodId: string): Promise<PayPeriod | null> {
    return prisma.payPeriod.findUnique({ where: { id: periodId } });
  }
}

export const payPeriodService = new PayPeriodService();
