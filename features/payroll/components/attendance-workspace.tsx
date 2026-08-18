"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { LONG_SHIFT_WARNING_HOURS } from "@/lib/payroll/compute-day";

import {
  correctAttendanceEntryAction,
  createManualAttendanceEntryAction,
} from "@/actions/attendance-record.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { attendanceRecordService } from "@/services/payroll/attendance-record.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });
const timeFormatter = new Intl.DateTimeFormat("en-PH", { timeStyle: "short", hour12: true });

interface AttendanceEmployee {
  id: string;
  name: string;
}

type AttendanceEntries = Awaited<ReturnType<typeof attendanceRecordService.listEntries>>;

interface AttendanceWorkspaceProps {
  employees: AttendanceEmployee[];
  entries: AttendanceEntries;
  // Same reasoning as EmployeeRateManager's own hideEmployeePicker — the
  // per-employee payroll profile page passes a single-employee roster and
  // already shows that name in its own header.
  hideEmployeePicker?: boolean;
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Combines a "YYYY-MM-DD" date value with an "HH:MM" time value into one
// local-timezone Date — same combineDateAndTime shape the (since-
// discarded) staff-schedule.service.ts used for the same reason: the
// two are separate inputs in the form but one instant in the DB.
function combineDateAndTime(dateValue: string, timeValue: string): Date | null {
  if (!dateValue || !timeValue) {
    return null;
  }
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes);
}

// Owner decision (2026-08-18): a shift whose clock-out is at or before its
// clock-in is an OVERNIGHT shift, not an error — 23:00-01:00 is one night's
// work. The form rolls the end to the next day rather than asking staff for
// a second date on every ordinary shift.
//
// The roll is never silent. resolveShiftWindow returns `rolled` so the form
// can state what it did BEFORE submit: entering 05:00 when 15:00 was meant
// would otherwise become a 14-hour shift that nobody notices until payroll.
function resolveShiftWindow(
  dateValue: string,
  clockInTime: string,
  clockOutTime: string,
): { clockIn: Date | null; clockOut: Date | null; rolled: boolean; spanHours: number | null } {
  const clockIn = combineDateAndTime(dateValue, clockInTime);
  if (!clockIn) {
    return { clockIn: null, clockOut: null, rolled: false, spanHours: null };
  }
  let clockOut = clockOutTime ? combineDateAndTime(dateValue, clockOutTime) : null;
  let rolled = false;
  if (clockOut && clockOut.getTime() <= clockIn.getTime()) {
    clockOut = new Date(clockOut.getTime() + 24 * 60 * 60 * 1000);
    rolled = true;
  }
  const spanHours = clockOut ? (clockOut.getTime() - clockIn.getTime()) / 3_600_000 : null;
  return { clockIn, clockOut, rolled, spanHours };
}

const nextDayFormatter = new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short" });

// Shown inline under the clock-out field. Two separate messages on purpose:
// the roll is a statement of fact, the long span is a caution.
function ShiftWindowNote({
  clockOut,
  rolled,
  spanHours,
}: {
  clockOut: Date | null;
  rolled: boolean;
  spanHours: number | null;
}) {
  if (!clockOut) {
    return null;
  }
  const isLong = spanHours !== null && spanHours > LONG_SHIFT_WARNING_HOURS;
  if (!rolled && !isLong) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      {rolled ? (
        <p className="text-muted-foreground text-xs">
          Ends {clockOut.toTimeString().slice(0, 5)} the next day, {nextDayFormatter.format(clockOut)}.
        </p>
      ) : null}
      {isLong ? (
        <p className="text-xs text-amber-600 dark:text-amber-500" role="status">
          That is a {spanHours!.toFixed(1)}-hour shift — longer than {LONG_SHIFT_WARNING_HOURS} hours.
          Double-check the times if that was not intended.
        </p>
      ) : null}
    </div>
  );
}

function NewEntryForm({
  employees,
  hideEmployeePicker = false,
}: {
  employees: AttendanceEmployee[];
  hideEmployeePicker?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [workDate, setWorkDate] = useState(toLocalDateValue(new Date()));
  const [clockInTime, setClockInTime] = useState("");
  const [clockOutTime, setClockOutTime] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  // Recomputed on every keystroke so the note reflects what WILL be
  // submitted, not what was submitted last time.
  const preview = resolveShiftWindow(workDate, clockInTime, clockOutTime);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const { clockIn, clockOut } = resolveShiftWindow(workDate, clockInTime, clockOutTime);
    if (!employeeId || !clockIn) {
      setServerError("Select an employee, work date, and clock-in time.");
      return;
    }

    startTransition(async () => {
      // No workDate: the service derives which business day this belongs
      // to from clockIn (computeBusinessDate), so the form no longer has to
      // reason about it — which is what got overnight shifts filed under
      // the wrong night before.
      const result = await createManualAttendanceEntryAction({
        employeeId,
        clockIn,
        clockOut: clockOut ?? undefined,
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Attendance entry created.");
      setClockInTime("");
      setClockOutTime("");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New manual entry</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {hideEmployeePicker ? null : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attendanceEmployee">Employee</Label>
              <Select value={employeeId} onValueChange={(value) => value && setEmployeeId(value)}>
                <SelectTrigger id="attendanceEmployee">
                  <SelectValue placeholder="Select an employee">
                    {employees.find((employee) => employee.id === employeeId)?.name}
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
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attendanceWorkDate">Work date</Label>
              <Input
                id="attendanceWorkDate"
                type="date"
                value={workDate}
                onChange={(event) => setWorkDate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attendanceClockIn">Clock in</Label>
              <Input
                id="attendanceClockIn"
                type="time"
                value={clockInTime}
                onChange={(event) => setClockInTime(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="attendanceClockOut">Clock out (optional)</Label>
              <Input
                id="attendanceClockOut"
                type="time"
                value={clockOutTime}
                onChange={(event) => setClockOutTime(event.target.value)}
              />
            </div>
          </div>
          <ShiftWindowNote
            clockOut={preview.clockOut}
            rolled={preview.rolled}
            spanHours={preview.spanHours}
          />
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending} className="w-fit">
            {isPending ? "Saving…" : "Add entry"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function CorrectEntryRow({ entry }: { entry: AttendanceEntries[number] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const workDateValue = toLocalDateValue(entry.workDate);
  const [clockInTime, setClockInTime] = useState(entry.clockIn.toTimeString().slice(0, 5));
  const [clockOutTime, setClockOutTime] = useState(
    entry.clockOut ? entry.clockOut.toTimeString().slice(0, 5) : "",
  );
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);

  const preview = resolveShiftWindow(workDateValue, clockInTime, clockOutTime);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const { clockIn, clockOut } = resolveShiftWindow(workDateValue, clockInTime, clockOutTime);
    if (!clockIn) {
      setServerError("Clock-in time is required.");
      return;
    }
    if (!reason.trim()) {
      setServerError("Enter a reason for this correction.");
      return;
    }

    startTransition(async () => {
      const result = await correctAttendanceEntryAction({
        recordId: entry.id,
        clockIn,
        clockOut: clockOut ?? undefined,
        reason: reason.trim(),
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Attendance entry corrected.");
      setOpen(false);
      setReason("");
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Correct…
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-left"
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`correctClockIn-${entry.id}`} className="text-xs">
            Clock in
          </Label>
          <Input
            id={`correctClockIn-${entry.id}`}
            type="time"
            value={clockInTime}
            onChange={(event) => setClockInTime(event.target.value)}
          />
        </div>
      <ShiftWindowNote
        clockOut={preview.clockOut}
        rolled={preview.rolled}
        spanHours={preview.spanHours}
      />
        <div className="flex flex-col gap-1">
          <Label htmlFor={`correctClockOut-${entry.id}`} className="text-xs">
            Clock out
          </Label>
          <Input
            id={`correctClockOut-${entry.id}`}
            type="time"
            value={clockOutTime}
            onChange={(event) => setClockOutTime(event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`correctReason-${entry.id}`} className="text-xs">
          Reason (required)
        </Label>
        <Textarea
          id={`correctReason-${entry.id}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {serverError ? (
        <p className="text-destructive text-xs" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? "Saving…" : "Save correction"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AttendanceWorkspace({
  employees,
  entries,
  hideEmployeePicker = false,
}: AttendanceWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      <NewEntryForm employees={employees} hideEmployeePicker={hideEmployeePicker} />

      <Card>
        <CardHeader>
          <CardTitle>Recent entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm">No attendance entries yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {hideEmployeePicker ? null : <TableHead>Employee</TableHead>}
                  <TableHead>Work date</TableHead>
                  <TableHead>Clock in</TableHead>
                  <TableHead>Clock out</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Correction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    {hideEmployeePicker ? null : (
                      <TableCell className="font-medium">
                        {entry.employee.firstName} {entry.employee.lastName}
                      </TableCell>
                    )}
                    <TableCell>{dateFormatter.format(entry.workDate)}</TableCell>
                    <TableCell>{timeFormatter.format(entry.clockIn)}</TableCell>
                    <TableCell>
                      {entry.clockOut ? timeFormatter.format(entry.clockOut) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {entry.source === "MANUAL" ? "Manual" : "Live"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1.5">
                        {entry.correctedAt ? (
                          <p className="text-muted-foreground text-xs">
                            Corrected by{" "}
                            {entry.correctedBy?.name ?? entry.correctedBy?.email ?? "—"}
                            <br />
                            {entry.correctionReason}
                          </p>
                        ) : null}
                        <CorrectEntryRow entry={entry} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
