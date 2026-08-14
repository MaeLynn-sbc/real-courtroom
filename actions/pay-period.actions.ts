"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createPayPeriodSchema,
  deletePayPeriodSchema,
  updatePayPeriodSchema,
  type CreatePayPeriodInput,
  type DeletePayPeriodInput,
  type UpdatePayPeriodInput,
} from "@/features/payroll/schemas/pay-period.schema";
import { toCsv, type CsvColumn } from "@/services/export/export.service";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { checkRateLimit } from "@/lib/rate-limit";
import { payPeriodService } from "@/services/payroll/pay-period.service";
import { payrollComputationService, type PayPeriodDay } from "@/services/payroll/payroll-computation.service";
import { PERMISSIONS } from "@/types/permissions";

function requirePayrollManage() {
  return requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
}

function revalidatePeriods(): void {
  revalidatePath("/dashboard/payroll/periods");
}

export interface PayPeriodActionState {
  error: string | null;
}

export async function createPayPeriodAction(input: CreatePayPeriodInput): Promise<PayPeriodActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createPayPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid period." };
  }

  try {
    await payPeriodService.createPeriod(parsed.data.startDate, parsed.data.endDate);
    revalidatePeriods();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "createPayPeriodAction", userId: authz.userId }) };
  }
}

export async function updatePayPeriodAction(input: UpdatePayPeriodInput): Promise<PayPeriodActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updatePayPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid period." };
  }

  try {
    await payPeriodService.updatePeriod(parsed.data.periodId, {
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    });
    revalidatePeriods();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updatePayPeriodAction", userId: authz.userId }) };
  }
}

export async function deletePayPeriodAction(input: DeletePayPeriodInput): Promise<PayPeriodActionState> {
  const authz = await requirePayrollManage();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = deletePayPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await payPeriodService.deletePeriod(parsed.data.periodId);
    revalidatePeriods();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "deletePayPeriodAction", userId: authz.userId }) };
  }
}

const EXPORT_RATE_LIMIT = 20;
const EXPORT_RATE_LIMIT_WINDOW_MS = 60 * 1000;

const exportPayPeriodSchema = z.object({
  employeeId: z.string().min(1),
  periodId: z.string().min(1),
});

export type ExportPayPeriodInput = z.infer<typeof exportPayPeriodSchema>;

export interface ExportPayPeriodActionState {
  error: string | null;
  filename?: string;
  csv?: string;
}

const PAY_PERIOD_CSV_COLUMNS: CsvColumn<PayPeriodDay>[] = [
  { header: "Date", value: (r) => r.workDate },
  { header: "Scheduled start", value: (r) => r.scheduledStart },
  { header: "Scheduled end", value: (r) => r.scheduledEnd },
  { header: "Clock in", value: (r) => r.clockIn },
  { header: "Clock out", value: (r) => r.clockOut },
  { header: "Regular minutes", value: (r) => r.regularMinutes },
  { header: "OT minutes", value: (r) => r.otMinutes },
  { header: "Night diff minutes", value: (r) => r.nightDiffMinutes },
  { header: "Late deducted minutes", value: (r) => r.lateDeductedMinutes },
  { header: "Undertime minutes (not deducted)", value: (r) => r.undertimeMinutes },
  { header: "Base pay (cents)", value: (r) => (r.excludedFromTotal ? "" : Math.round(r.basePayCents)) },
  { header: "OT pay (cents)", value: (r) => (r.excludedFromTotal ? "" : Math.round(r.otPayCents)) },
  { header: "Night diff pay (cents)", value: (r) => (r.excludedFromTotal ? "" : Math.round(r.nightDiffPayCents)) },
  { header: "Late deduction (cents)", value: (r) => (r.excludedFromTotal ? "" : Math.round(r.lateDeductionCents)) },
  { header: "Day gross (cents)", value: (r) => (r.excludedFromTotal ? "" : Math.round(r.dayGrossCents)) },
  { header: "Flags", value: (r) => r.flags.map((f) => f.code).join("; ") },
];

export async function exportPayPeriodCsvAction(
  input: ExportPayPeriodInput,
): Promise<ExportPayPeriodActionState> {
  const authz = await requirePermission(
    PERMISSIONS.PAYROLL_MANAGE,
    "You don't have permission to manage payroll.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const rateLimit = checkRateLimit(
    `export-pay-period:${authz.userId}`,
    EXPORT_RATE_LIMIT,
    EXPORT_RATE_LIMIT_WINDOW_MS,
  );
  if (!rateLimit.allowed) {
    return { error: "Too many exports — please wait a moment and try again." };
  }

  const parsed = exportPayPeriodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid export request." };
  }

  try {
    const computation = await payrollComputationService.computeEmployeePeriod(
      parsed.data.employeeId,
      parsed.data.periodId,
    );
    const csv = toCsv(computation.days, PAY_PERIOD_CSV_COLUMNS);
    const filename = `pay-period-${parsed.data.periodId}-${parsed.data.employeeId}.csv`;
    return { error: null, filename, csv };
  } catch (error) {
    return { error: toActionError(error, { action: "exportPayPeriodCsvAction", userId: authz.userId }) };
  }
}
