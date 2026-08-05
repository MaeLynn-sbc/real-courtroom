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

// Semi-monthly, cutoffs at the 10th and 25th (owner-corrected 2026-08-06 —
// the original 1st-15th/16th-end-of-month cadence was wrong and had
// already materialized a handful of PayPeriod rows on production under
// it; see deletePeriod below for cleaning those up). Periods are [26 ->
// 10 of the following month] and [11 -> 25], never variable-length by
// month-end the way the old cadence was — month/year rollover for the
// 26-10 period is handled by JS Date's own month-overflow normalization
// (new Date(y, m+1, 10) / new Date(y, m-1, 26) both roll over correctly
// at a December/January boundary). Pure and directly unit-testable — no
// Prisma import.
export function computeSemiMonthlyPeriodBounds(date: Date): { startDate: Date; endDate: Date } {
  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  if (day >= 11 && day <= 25) {
    return { startDate: new Date(year, month, 11), endDate: new Date(year, month, 25) };
  }
  if (day >= 26) {
    return { startDate: new Date(year, month, 26), endDate: new Date(year, month + 1, 10) };
  }
  // day <= 10 — this date belongs to the period that started the 26th of
  // the PREVIOUS month.
  return { startDate: new Date(year, month - 1, 26), endDate: new Date(year, month, 10) };
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

  // Corrects a mis-generated period's dates directly — e.g. the batch of
  // rows the old, wrong cadence formula already materialized. Safe to
  // edit or delete freely: nothing has a foreign key onto PayPeriod (no
  // EmployeeRate/AttendanceRecord/ScheduleAssignment row points at one),
  // and computeEmployeePeriod re-derives everything fresh from a period's
  // dates on every read rather than caching anything against its id.
  async updatePeriod(
    periodId: string,
    input: { startDate?: Date; endDate?: Date },
  ): Promise<PayPeriod> {
    const startDate = input.startDate;
    const endDate = input.endDate;
    if (startDate && endDate && endDate < startDate) {
      throw new Error("End date must be on or after the start date.");
    }
    return prisma.payPeriod.update({
      where: { id: periodId },
      data: { startDate, endDate },
    });
  }

  async deletePeriod(periodId: string): Promise<void> {
    await prisma.payPeriod.delete({ where: { id: periodId } });
  }
}

export const payPeriodService = new PayPeriodService();
