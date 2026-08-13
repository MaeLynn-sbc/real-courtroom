import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatVariance } from "@/lib/utils";

interface OnDutyShift {
  id: string;
  shiftNumber: string;
  employeeName: string;
  startedAt: Date;
}

interface RecentShift {
  id: string;
  shiftNumber: string;
  employeeName: string;
  status: string;
  startedAt: Date;
  endedAt: Date | null;
  varianceCents: number | null;
}

interface ShiftOverviewPanelProps {
  onDuty: OnDutyShift[];
  recentShifts: RecentShift[];
}

const timeFormatter = new Intl.DateTimeFormat("en-PH", { timeStyle: "short" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Owner request (2026-08-08): the main dashboard's shift panel is
// deliberately Owner-excluded (MyShiftPanel is a cashier/reception
// clock-in workflow, not something the Owner personally runs) — but
// that left Owner/Admin with zero shift visibility at all on the
// dashboard itself, only reachable via a full navigation to
// /dashboard/shift. This is the read-only oversight counterpart: who's
// on duty right now, and the most recent shifts, each with a stub link
// through to the full review list. Gated the same way that page's own
// "review every employee's shift" mode already is (REPORTS_MANAGE) —
// no new permission invented here.
export function ShiftOverviewPanel({ onDuty, recentShifts }: ShiftOverviewPanelProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Shifts</CardTitle>
        <Link
          href="/dashboard/shift"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          View all
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-[10px] font-bold tracking-[0.12em] uppercase">
            On duty now
          </p>
          {onDuty.length === 0 ? (
            // Was a bare muted sentence, indistinguishable from any other
            // caption on the page. Nobody at the desk is an operational
            // state worth noticing, so it now reads as an empty state.
            <p className="border-border/70 text-muted-foreground rounded-lg border border-dashed px-3 py-2.5 text-sm">
              Nobody currently clocked in.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {onDuty.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="bg-success size-1.5 shrink-0 rounded-full"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">{shift.employeeName}</span>
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {shift.shiftNumber} · since {timeFormatter.format(shift.startedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          <p className="text-muted-foreground mb-2 text-[10px] font-bold tracking-[0.12em] uppercase">
            Recent shifts
          </p>
          {recentShifts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No shifts yet.</p>
          ) : (
            <div className="flex flex-col">
              {recentShifts.slice(0, 5).map((shift) => (
                <div
                  key={shift.id}
                  className="border-border/50 flex items-center justify-between gap-3 border-b py-2.5 text-sm last:border-b-0"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{shift.employeeName}</span>
                    <span className="text-muted-foreground block text-xs">
                      {dateTimeFormatter.format(shift.startedAt)}
                    </span>
                  </span>
                  {shift.status === "OPEN" ? (
                    <Badge variant="status">Open</Badge>
                  ) : shift.varianceCents ? (
                    // A drawer that did not balance is the one line on
                    // this card an owner has to act on, and it was set in
                    // the same 12px muted-weight type as the timestamp
                    // beside it. Given a chip so it separates from the
                    // "Matched" rows at a glance rather than on a read.
                    <span className="bg-destructive/10 text-destructive shrink-0 rounded-md px-2 py-1 text-xs font-bold tabular-nums">
                      {formatVariance(shift.varianceCents)}
                    </span>
                  ) : (
                    <span className="text-success shrink-0 text-xs font-medium">Matched</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
