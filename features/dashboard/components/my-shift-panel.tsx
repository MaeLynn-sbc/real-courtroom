import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";

interface MyShiftPanelShift {
  shiftNumber: string;
  startedAt: Date;
  openingCashCents: number;
}

interface MyShiftPanelSales {
  totalAmountCents: number;
  transactionCount: number;
}

interface MyShiftPanelProps {
  shift: MyShiftPanelShift | null;
  sales: MyShiftPanelSales | null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

// Status glance only — starting/ending a shift still happens on the
// existing /dashboard/shift workspace (Sub-phase 1), not duplicated here.
export function MyShiftPanel({ shift, sales }: MyShiftPanelProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>My shift</CardTitle>
        {shift ? <Badge variant="secondary">Open</Badge> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {shift ? (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Shift number</p>
                <p className="font-medium">{shift.shiftNumber}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Started</p>
                <p className="font-medium">{dateTimeFormatter.format(shift.startedAt)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Opening cash</p>
                <p className="font-medium">{formatCurrency(shift.openingCashCents)}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">This shift&apos;s sales</p>
                <p className="font-medium">
                  {formatCurrency(sales?.totalAmountCents ?? 0)}
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    ({sales?.transactionCount ?? 0} transaction{sales?.transactionCount === 1 ? "" : "s"})
                  </span>
                </p>
              </div>
            </div>
            <Link href="/dashboard/shift" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Manage shift
            </Link>
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              No shift open — start one before creating bookings, rentals, or registrations.
            </p>
            <Link href="/dashboard/shift" className={buttonVariants({ size: "sm" })}>
              Start shift
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
