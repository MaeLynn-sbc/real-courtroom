import type { PayrollMarkedDate } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Payroll Batch 2c. Deliberately the simplest possible owner-editable list
// — a date + label, nothing more. See the schema comment on
// PayrollMarkedDate for why this doesn't attempt recurrence, a regular-vs-
// special distinction, or a multiplier. No audit log — unlike EmployeeRate,
// deleting a row here can't retroactively change a persisted pay number
// (computation writes nothing), so the lighter-weight treatment is fine.
export class PayrollMarkedDateService {
  async listMarkedDates(): Promise<PayrollMarkedDate[]> {
    return prisma.payrollMarkedDate.findMany({ orderBy: { date: "desc" } });
  }

  // Used by the computation engine to check one period's worth of dates in
  // a single query rather than one findUnique per day.
  async listMarkedDatesInRange(from: Date, to: Date): Promise<PayrollMarkedDate[]> {
    return prisma.payrollMarkedDate.findMany({
      where: { date: { gte: toMidnight(from), lte: toMidnight(to) } },
    });
  }

  async createMarkedDate(date: Date, label: string, actorUserId: string): Promise<PayrollMarkedDate> {
    if (!label.trim()) {
      throw new Error("Enter a label for this date.");
    }

    return prisma.payrollMarkedDate.create({
      data: { date: toMidnight(date), label: label.trim(), createdByUserId: actorUserId },
    });
  }

  async deleteMarkedDate(markedDateId: string): Promise<void> {
    await prisma.payrollMarkedDate.delete({ where: { id: markedDateId } });
  }
}

export const payrollMarkedDateService = new PayrollMarkedDateService();
