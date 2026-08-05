"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createEmployeeRateAction, deleteEmployeeRateAction } from "@/actions/employee-rate.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";

interface RosterEmployee {
  id: string;
  name: string;
}

interface RateRow {
  id: string;
  dailyRateCents: number;
  effectiveFrom: Date;
  note: string | null;
}

interface EmployeeRateManagerProps {
  employees: RosterEmployee[];
  selectedEmployeeId: string;
  rates: RateRow[];
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function EmployeeRateManager({ employees, selectedEmployeeId, rates }: EmployeeRateManagerProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dailyRate, setDailyRate] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(toDateValue(new Date()));
  const [note, setNote] = useState("");

  function onSelectEmployee(employeeId: string) {
    router.push(`/dashboard/payroll/rates?employeeId=${employeeId}`);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const rateCents = Math.round(Number(dailyRate) * 100);
    if (!selectedEmployeeId || !Number.isFinite(rateCents) || rateCents <= 0) {
      setServerError("Enter a valid daily rate.");
      return;
    }

    startTransition(async () => {
      const result = await createEmployeeRateAction({
        employeeId: selectedEmployeeId,
        dailyRateCents: rateCents,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00`),
        note: note.trim() || undefined,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Rate added.");
      setDailyRate("");
      setNote("");
      router.refresh();
    });
  }

  function onDelete(rateId: string) {
    startTransition(async () => {
      const result = await deleteEmployeeRateAction({ rateId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Rate removed.");
      router.refresh();
    });
  }

  // Only the newest row (rates[0], since the page orders desc by
  // effectiveFrom) can be deleted — see employee-rate.service.ts's
  // deleteLatestRate for why an older row is refused server-side too.
  const latestRateId = rates[0]?.id;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="employeeId">Employee</Label>
        <Select value={selectedEmployeeId} onValueChange={(value) => value && onSelectEmployee(value)}>
          <SelectTrigger id="employeeId" className="w-full max-w-sm">
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

      {selectedEmployeeId ? (
        <>
          <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dailyRate">Daily rate (₱)</Label>
              <Input
                id="dailyRate"
                type="number"
                min={0}
                step="0.01"
                value={dailyRate}
                onChange={(event) => setDailyRate(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="effectiveFrom">Effective from</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={effectiveFrom}
                onChange={(event) => setEffectiveFrom(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rateNote">Note (optional)</Label>
              <Input
                id="rateNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="e.g. annual raise"
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Add rate"}
            </Button>
          </form>

          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}

          {rates.length === 0 ? (
            <p className="text-muted-foreground text-sm">No rates set for this employee yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Daily rate</TableHead>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell>{formatCurrency(rate.dailyRateCents)}</TableCell>
                    <TableCell>{dateFormatter.format(rate.effectiveFrom)}</TableCell>
                    <TableCell className="text-muted-foreground">{rate.note ?? "—"}</TableCell>
                    <TableCell>
                      {rate.id === latestRateId ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={isPending}
                          onClick={() => onDelete(rate.id)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      ) : null}
    </div>
  );
}
