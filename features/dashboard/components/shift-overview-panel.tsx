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
const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

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
        <Link href="/dashboard/shift" className={buttonVariants({ variant: "outline", size: "sm" })}>
          View all
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-muted-foreground mb-2 text-xs">On duty now</p>
          {onDuty.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody currently clocked in.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {onDuty.map((shift) => (
                <div key={shift.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{shift.employeeName}</span>
                  <span className="text-muted-foreground text-xs">
                    {shift.shiftNumber} · since {timeFormatter.format(shift.startedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t pt-3">
          <p className="text-muted-foreground mb-2 text-xs">Recent shifts</p>
          {recentShifts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No shifts yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {recentShifts.slice(0, 5).map((shift) => (
                <div key={shift.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{shift.employeeName}</span>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    {dateTimeFormatter.format(shift.startedAt)}
                  </span>
                  {shift.status === "OPEN" ? (
                    <Badge variant="status">Open</Badge>
                  ) : shift.varianceCents ? (
                    <span className="text-destructive shrink-0 text-xs font-medium">
                      {formatVariance(shift.varianceCents)}
                    </span>
                  ) : (
                    <span className="text-success shrink-0 text-xs">Matched</span>
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
