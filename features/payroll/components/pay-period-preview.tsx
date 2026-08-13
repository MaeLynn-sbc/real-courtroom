"use client";

import { Download, Printer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { exportPayPeriodCsvAction } from "@/actions/pay-period.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { siteConfig } from "@/lib/config";
import { formatCurrency } from "@/lib/utils";

interface RosterEmployee {
  id: string;
  name: string;
}

interface FlagRow {
  code: string;
  message: string;
}

interface DayRow {
  workDate: Date;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  clockIn: Date | null;
  clockOut: Date | null;
  regularMinutes: number;
  otMinutes: number;
  nightDiffMinutes: number;
  lateDeductedMinutes: number;
  undertimeMinutes: number;
  dayGrossCents: number;
  excludedFromTotal: boolean;
  flags: FlagRow[];
}

interface Totals {
  regularMinutes: number;
  otMinutes: number;
  nightDiffMinutes: number;
  lateDeductedMinutes: number;
  undertimeMinutes: number;
  grossCents: number;
}

interface PayPeriodPreviewProps {
  periodId: string;
  periodLabel: string;
  // Computed server-side and passed down, not read via `new Date()` in this
  // client component's render — that would render one value during SSR and
  // a different one at client hydration, a real (if easy to miss)
  // hydration mismatch.
  generatedAtLabel: string;
  employees: RosterEmployee[];
  selectedEmployeeId: string;
  days: DayRow[];
  totals: Totals;
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });

function formatTime(date: Date | null): string {
  return date ? timeFormatter.format(date) : "—";
}

function formatMinutes(minutes: number): string {
  return minutes === 0 ? "—" : minutes.toFixed(minutes % 1 === 0 ? 0 : 2);
}

export function PayPeriodPreview({
  periodId,
  periodLabel,
  generatedAtLabel,
  employees,
  selectedEmployeeId,
  days,
  totals,
}: PayPeriodPreviewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const selectedEmployeeName = employees.find((employee) => employee.id === selectedEmployeeId)?.name ?? "—";

  function onSelectEmployee(employeeId: string) {
    router.push(`/dashboard/payroll/periods/${periodId}?employeeId=${employeeId}`);
  }

  function onExport() {
    startTransition(async () => {
      const result = await exportPayPeriodCsvAction({ employeeId: selectedEmployeeId, periodId });
      if (result.error || !result.csv || !result.filename) {
        toast.error(result.error ?? "Failed to export.");
        return;
      }
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  const allFlags = days.flatMap((day) => day.flags.map((flag) => ({ workDate: day.workDate, ...flag })));

  return (
    <div className="flex flex-col gap-6">
      {/* Unlike the page's own <h1> and the employee picker below (both
          print:hidden), this survives print — a payslip with no name or
          pay period on it is useless once it's off the screen. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-3">
        <div>
          <p className="text-lg font-semibold tracking-tight">{siteConfig.name} — Payslip</p>
          <p className="text-muted-foreground text-sm">{selectedEmployeeName}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium">{periodLabel}</p>
          <p className="text-muted-foreground text-xs">Generated {generatedAtLabel}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="periodEmployeeId" className="text-sm font-medium">
            Employee
          </label>
          <Select value={selectedEmployeeId} onValueChange={(value) => value && onSelectEmployee(value)}>
            <SelectTrigger id="periodEmployeeId" className="w-full max-w-sm">
              <SelectValue placeholder="Select an employee">
                {(value: string) => employees.find((e) => e.id === value)?.name ?? "Select an employee"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            Print
          </Button>
          <Button type="button" variant="outline" disabled={isPending} onClick={onExport}>
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="text-sm font-medium">Exceptions</h2>
        {allFlags.length === 0 ? (
          <p className="text-muted-foreground text-sm">No exceptions.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {allFlags.map((flag, index) => (
              <li key={`${flag.workDate.toISOString()}-${flag.code}-${index}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">{dateFormatter.format(flag.workDate)}</span>
                <Badge variant="destructive">{flag.code}</Badge>
                <span>{flag.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col items-start gap-1 rounded-xl border p-4">
        <span className="text-3xl font-semibold tracking-tight">GROSS: {formatCurrency(totals.grossCents)}</span>
        <p className="text-muted-foreground text-xs">
          Gross pay only — no SSS/PhilHealth/Pag-IBIG/withholding/cash-advance deductions applied.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead>Clock in/out</TableHead>
              <TableHead>Regular</TableHead>
              <TableHead>OT</TableHead>
              <TableHead>Night diff</TableHead>
              <TableHead>Late deducted</TableHead>
              <TableHead>Undertime (shown, not deducted)</TableHead>
              <TableHead>Day gross</TableHead>
              <TableHead>Flags</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((day) => (
              <TableRow key={day.workDate.toISOString()}>
                <TableCell className="whitespace-nowrap">{dateFormatter.format(day.workDate)}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {day.scheduledStart && day.scheduledEnd
                    ? `${formatTime(day.scheduledStart)}–${formatTime(day.scheduledEnd)}`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatTime(day.clockIn)}–{formatTime(day.clockOut)}
                </TableCell>
                <TableCell>{formatMinutes(day.regularMinutes)}</TableCell>
                <TableCell>{formatMinutes(day.otMinutes)}</TableCell>
                <TableCell>{formatMinutes(day.nightDiffMinutes)}</TableCell>
                <TableCell>{formatMinutes(day.lateDeductedMinutes)}</TableCell>
                <TableCell>{formatMinutes(day.undertimeMinutes)}</TableCell>
                <TableCell className="font-medium">
                  {day.excludedFromTotal ? "—" : formatCurrency(Math.round(day.dayGrossCents))}
                </TableCell>
                <TableCell>
                  {day.flags.length === 0 ? null : (
                    <div className="flex flex-wrap gap-1">
                      {day.flags.map((flag) => (
                        <Badge key={flag.code} variant="destructive" className="text-[10px]">
                          {flag.code}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-2 gap-3 rounded-xl border p-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <p className="text-muted-foreground text-xs">Regular</p>
          <p className="font-medium">{formatMinutes(totals.regularMinutes)} min</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">OT</p>
          <p className="font-medium">{formatMinutes(totals.otMinutes)} min</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Night diff</p>
          <p className="font-medium">{formatMinutes(totals.nightDiffMinutes)} min</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Late deducted</p>
          <p className="font-medium">{formatMinutes(totals.lateDeductedMinutes)} min</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Undertime (not deducted)</p>
          <p className="font-medium">{formatMinutes(totals.undertimeMinutes)} min</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Gross</p>
          <p className="font-medium">{formatCurrency(totals.grossCents)}</p>
        </div>
      </div>

      <style>{`
        @media print {
          nav, header, .print\\:hidden {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
