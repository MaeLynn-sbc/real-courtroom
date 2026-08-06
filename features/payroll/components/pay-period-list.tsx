"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createPayPeriodAction,
  deletePayPeriodAction,
  updatePayPeriodAction,
} from "@/actions/pay-period.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PayPeriodRow {
  id: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Owner request (2026-08-06): periods generated under the old, wrong
// cadence formula are already sitting in the database — this exists so
// they can be corrected or removed directly, same "make everything
// editable" pattern already applied to EmployeeRate and
// PayrollMarkedDate. Safe per pay-period.service.ts's own comment:
// nothing has a foreign key onto PayPeriod.
//
// Also owns the "Add period" form (same day) — the page itself now only
// auto-generates the period containing today (see PayPeriodsPage's own
// comment on why the old rolling-2-month backfill was removed); an older
// date the auto-generation never reaches has to be added here manually.
export function PayPeriodList({ periods }: { periods: PayPeriodRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  function onCreate() {
    if (!newStart || !newEnd) {
      toast.error("Enter both a start and end date.");
      return;
    }
    startTransition(async () => {
      const result = await createPayPeriodAction({
        startDate: new Date(`${newStart}T00:00:00`),
        endDate: new Date(`${newEnd}T00:00:00`),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Period added.");
      setIsAdding(false);
      setNewStart("");
      setNewEnd("");
      router.refresh();
    });
  }

  function startEdit(period: PayPeriodRow) {
    setEditingId(period.id);
    setEditStart(toDateValue(period.startDate));
    setEditEnd(toDateValue(period.endDate));
  }

  function onSaveEdit(periodId: string) {
    startTransition(async () => {
      const result = await updatePayPeriodAction({
        periodId,
        startDate: new Date(`${editStart}T00:00:00`),
        endDate: new Date(`${editEnd}T00:00:00`),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Period updated.");
      setEditingId(null);
      router.refresh();
    });
  }

  function onDelete(periodId: string) {
    startTransition(async () => {
      const result = await deletePayPeriodAction({ periodId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Period removed.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-md border border-dashed px-3 py-2">
        {isAdding ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Input
              type="date"
              value={newStart}
              onChange={(event) => setNewStart(event.target.value)}
              className="h-8 w-auto"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={newEnd}
              onChange={(event) => setNewEnd(event.target.value)}
              className="h-8 w-auto"
            />
            <div className="ml-auto flex gap-1.5">
              <Button type="button" size="sm" disabled={isPending} onClick={onCreate}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => setIsAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={() => setIsAdding(true)}
          >
            + Add period
          </Button>
        )}
      </div>

      {periods.length === 0 ? (
        <p className="text-muted-foreground text-sm">No pay periods yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {periods.map((period) =>
            editingId === period.id ? (
              <li
                key={period.id}
                className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <Input
                  type="date"
                  value={editStart}
                  onChange={(event) => setEditStart(event.target.value)}
                  className="h-8 w-auto"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="date"
                  value={editEnd}
                  onChange={(event) => setEditEnd(event.target.value)}
                  className="h-8 w-auto"
                />
                <div className="ml-auto flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending}
                    onClick={() => onSaveEdit(period.id)}
                  >
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
              </li>
            ) : (
              <li
                key={period.id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
              >
                <Link
                  href={`/dashboard/payroll/periods/${period.id}`}
                  className="flex-1 hover:underline"
                >
                  {dateFormatter.format(period.startDate)} – {dateFormatter.format(period.endDate)}
                  <span className="text-muted-foreground ml-2 text-xs tracking-wide uppercase">
                    {period.status}
                  </span>
                </Link>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => startEdit(period)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => onDelete(period.id)}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
