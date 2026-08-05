"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createMarkedDateAction,
  deleteMarkedDateAction,
  updateMarkedDateAction,
} from "@/actions/payroll-marked-date.actions";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editLabel, setEditLabel] = useState("");

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

  function startEdit(row: MarkedDateRow) {
    setEditingId(row.id);
    setEditDate(toDateValue(row.date));
    setEditLabel(row.label);
  }

  function onSaveEdit(markedDateId: string) {
    if (!editLabel.trim()) {
      toast.error("Enter a label.");
      return;
    }

    startTransition(async () => {
      const result = await updateMarkedDateAction({
        markedDateId,
        date: new Date(`${editDate}T00:00:00`),
        label: editLabel,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Updated.");
      setEditingId(null);
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
            {markedDates.map((row) =>
              editingId === row.id ? (
                <TableRow key={row.id}>
                  <TableCell>
                    <Input
                      type="date"
                      value={editDate}
                      onChange={(event) => setEditDate(event.target.value)}
                      className="h-8"
                    />
                  </TableCell>
                  <TableCell>
                    <Input value={editLabel} onChange={(event) => setEditLabel(event.target.value)} className="h-8" />
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Button type="button" size="sm" disabled={isPending} onClick={() => onSaveEdit(row.id)}>
                        Save
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isPending}
                        onClick={() => setEditingId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={row.id}>
                  <TableCell>{dateFormatter.format(row.date)}</TableCell>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => startEdit(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isPending}
                        onClick={() => onDelete(row.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
