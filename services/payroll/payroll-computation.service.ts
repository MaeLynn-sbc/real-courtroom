import { computeDay, type DayComputation } from "@/lib/payroll/compute-day";
import type { PayPeriod } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { payrollMarkedDateService } from "@/services/payroll/payroll-marked-date.service";

function toMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export interface PayPeriodTotals {
  regularMinutes: number;
  otMinutes: number;
  nightDiffMinutes: number;
  lateDeductedMinutes: number;
  undertimeMinutes: number;
  // Peso breakdown backing the payslip card — sums of each day's
  // basePayCents/otPayCents/nightDiffPayCents/lateDeductionCents (see
  // compute-day.ts), rounded once here in the same step as grossCents
  // below (rule 10) — not before.
  basePayCents: number;
  otPayCents: number;
  nightDiffPayCents: number;
  lateDeductionCents: number;
  // The only rounded number in the whole computation (rule 10) — every
  // per-day dayGrossCents stays an exact fraction until summed here.
  grossCents: number;
}

// The pure DayComputation plus the raw schedule/attendance times it was
// derived from — compute-day.ts itself has no reason to carry these
// (it's the whole computation, not a display concern), but the preview
// table and CSV export both need to show "Scheduled 7:00-15:00, Clocked
// 7:05-15:10" alongside the computed minutes.
export interface PayPeriodDay extends DayComputation {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  clockIn: Date | null;
  clockOut: Date | null;
}

export interface PayPeriodComputation {
  period: PayPeriod;
  employeeId: string;
  days: PayPeriodDay[];
  totals: PayPeriodTotals;
}

// Payroll Batch 2c. Writes nothing (rule 4) — a pure read-and-compute
// orchestrator. Fetches the whole period's rows in three range queries
// (not one per day) and calls lib/payroll/compute-day.ts's computeDay once
// per calendar day.
export class PayrollComputationService {
  async computeEmployeePeriod(employeeId: string, periodId: string): Promise<PayPeriodComputation> {
    const period = await prisma.payPeriod.findUniqueOrThrow({ where: { id: periodId } });
    const periodStart = toMidnight(period.startDate);
    const periodEnd = toMidnight(period.endDate);

    const [attendanceRecords, scheduleAssignments, rates, markedDates] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { employeeId, workDate: { gte: periodStart, lte: periodEnd } },
      }),
      prisma.scheduleAssignment.findMany({
        where: { employeeId, workDate: { gte: periodStart, lte: periodEnd } },
      }),
      prisma.employeeRate.findMany({
        where: { employeeId, effectiveFrom: { lte: periodEnd } },
        orderBy: { effectiveFrom: "desc" },
      }),
      payrollMarkedDateService.listMarkedDatesInRange(periodStart, periodEnd),
    ]);

    const attendanceByDate = new Map(attendanceRecords.map((r) => [toMidnight(r.workDate).getTime(), r]));
    const scheduleByDate = new Map(scheduleAssignments.map((r) => [toMidnight(r.workDate).getTime(), r]));
    const markedByDate = new Set(markedDates.map((m) => toMidnight(m.date).getTime()));

    // Same "most recent row with effectiveFrom <= day" resolution as
    // employee-rate.service.ts's resolveRateForDate, just done in memory
    // against the one batch of rows already fetched above instead of one
    // query per day.
    function rateForDate(date: Date): number | null {
      const target = date.getTime();
      const applicable = rates.find((r) => r.effectiveFrom.getTime() <= target);
      return applicable?.dailyRateCents ?? null;
    }

    const days: PayPeriodDay[] = [];
    for (let cursor = periodStart; cursor <= periodEnd; cursor = addDays(cursor, 1)) {
      const key = cursor.getTime();
      const attendance = attendanceByDate.get(key) ?? null;
      const schedule = scheduleByDate.get(key) ?? null;

      const computation = computeDay({
        workDate: cursor,
        scheduleAssignment: schedule
          ? { scheduledStart: schedule.scheduledStart, scheduledEnd: schedule.scheduledEnd }
          : null,
        attendanceRecord: attendance
          ? { clockIn: attendance.clockIn, clockOut: attendance.clockOut, correctedAt: attendance.correctedAt }
          : null,
        dailyRateCents: rateForDate(cursor),
        periodEndDate: periodEnd,
        isMarkedDate: markedByDate.has(key),
      });

      days.push({
        ...computation,
        scheduledStart: schedule?.scheduledStart ?? null,
        scheduledEnd: schedule?.scheduledEnd ?? null,
        clockIn: attendance?.clockIn ?? null,
        clockOut: attendance?.clockOut ?? null,
      });
    }

    const rawTotals = days.reduce(
      (acc, day) => ({
        regularMinutes: acc.regularMinutes + day.regularMinutes,
        otMinutes: acc.otMinutes + day.otMinutes,
        nightDiffMinutes: acc.nightDiffMinutes + day.nightDiffMinutes,
        lateDeductedMinutes: acc.lateDeductedMinutes + day.lateDeductedMinutes,
        undertimeMinutes: acc.undertimeMinutes + day.undertimeMinutes,
        basePayCents: acc.basePayCents + day.basePayCents,
        otPayCents: acc.otPayCents + day.otPayCents,
        nightDiffPayCents: acc.nightDiffPayCents + day.nightDiffPayCents,
        lateDeductionCents: acc.lateDeductionCents + day.lateDeductionCents,
        grossCents: acc.grossCents + day.dayGrossCents,
      }),
      {
        regularMinutes: 0,
        otMinutes: 0,
        nightDiffMinutes: 0,
        lateDeductedMinutes: 0,
        undertimeMinutes: 0,
        basePayCents: 0,
        otPayCents: 0,
        nightDiffPayCents: 0,
        lateDeductionCents: 0,
        grossCents: 0,
      },
    );

    return {
      period,
      employeeId,
      days,
      totals: {
        ...rawTotals,
        basePayCents: Math.round(rawTotals.basePayCents),
        otPayCents: Math.round(rawTotals.otPayCents),
        nightDiffPayCents: Math.round(rawTotals.nightDiffPayCents),
        lateDeductionCents: Math.round(rawTotals.lateDeductionCents),
        grossCents: Math.round(rawTotals.grossCents),
      },
    };
  }
}

export const payrollComputationService = new PayrollComputationService();
