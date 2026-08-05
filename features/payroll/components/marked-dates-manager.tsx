"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createMarkedDateAction, deleteMarkedDateAction } from "@/actions/payroll-marked-date.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface MarkedDateRow {
  id: string;
  date: Date;
  label: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function MarkedDatesManager({ markedDates }: { markedDates: MarkedDateRow[] }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [date, setDate] = useState(toDateValue(new Date()));
  const [label, setLabel] = useState("");

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!label.trim()) {
      setServerError("Enter a label.");
      return;
    }

    startTransition(async () => {
      const result = await createMarkedDateAction({ date: new Date(`${date}T00:00:00`), label });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Date marked.");
      setLabel("");
      router.refresh();
    });
  }

  function onDelete(markedDateId: string) {
    startTransition(async () => {
      const result = await deleteMarkedDateAction({ markedDateId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} noValidate className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="markedDate">Date</Label>
          <Input id="markedDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="markedLabel">Label</Label>
          <Input
            id="markedLabel"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="e.g. Rizal Day"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Mark date"}
        </Button>
      </form>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      {markedDates.length === 0 ? (
        <p className="text-muted-foreground text-sm">No dates marked yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Label</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {markedDates.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{dateFormatter.format(row.date)}</TableCell>
                <TableCell>{row.label}</TableCell>
                <TableCell>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => onDelete(row.id)}
                  >
                    Remove
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
