import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CASH_DENOMINATIONS_PESOS, type CashDenominationBreakdown } from "@/lib/cash-denominations";
import { formatCurrency } from "@/lib/utils";
import type { shiftService } from "@/services/shift/shift.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

type ShiftWithEmployee = NonNullable<Awaited<ReturnType<typeof shiftService.getShiftById>>>;

interface ShiftDetailProps {
  shift: ShiftWithEmployee;
}

export function ShiftDetail({ shift }: ShiftDetailProps) {
  // Stored, not re-queried live: closingCashCents and varianceCents were
  // computed together at close time (shiftService.endShift) from the
  // Sale rows that existed at that instant. Deriving expected from
  // those two stored numbers reconstructs exactly what the closer saw
  // and compared against, rather than a fresh Sale query that could in
  // principle disagree years later — the whole point of this page is
  // showing what was actually counted and decided, not a recomputation.
  const closingCashCents = shift.closingCashCents ?? 0;
  const varianceCents = shift.varianceCents ?? 0;
  const expectedCashCents = closingCashCents - varianceCents;
  const hasVariance = varianceCents !== 0;

  const breakdown = (shift.closingCashBreakdown ?? {}) as CashDenominationBreakdown;
  const countedDenominations = CASH_DENOMINATIONS_PESOS.filter((denomination) => {
    const quantity = breakdown[String(denomination)];
    return typeof quantity === "number" && quantity > 0;
  });

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/dashboard/shift" className="text-muted-foreground text-sm hover:underline">
          ‹ Back to Shift
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Shift {shift.shiftNumber}</CardTitle>
          <Badge variant="outline">Closed</Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <p className="text-muted-foreground text-xs">Employee</p>
              <p className="font-medium">
                {shift.employee.firstName} {shift.employee.lastName}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Started</p>
              <p className="font-medium">{dateTimeFormatter.format(shift.startedAt)}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Ended</p>
              <p className="font-medium">{shift.endedAt ? dateTimeFormatter.format(shift.endedAt) : "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Opening cash</p>
              <p className="font-medium">{formatCurrency(shift.openingCashCents)}</p>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm font-medium">Cash count as counted</p>
            {countedDenominations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No denomination breakdown was recorded for this shift.</p>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {countedDenominations.map((denomination) => {
                  const quantity = breakdown[String(denomination)];
                  return (
                    <div key={denomination} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground font-mono text-xs">₱{denomination} × {quantity}</span>
                      <span className="font-medium">{formatCurrency(denomination * 100 * quantity)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1 border-t pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Expected cash</span>
              <span className="font-medium">{formatCurrency(expectedCashCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Counted total</span>
              <span className="font-semibold">{formatCurrency(closingCashCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Variance</span>
              <span className={hasVariance ? "text-destructive font-semibold" : "text-success font-semibold"}>
                {varianceCents > 0 ? "+" : ""}
                {formatCurrency(varianceCents)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t pt-4">
            <p className="text-sm font-medium">Closing note</p>
            {shift.closingNotes ? (
              <p className="text-sm whitespace-pre-wrap">{shift.closingNotes}</p>
            ) : (
              <p className="text-muted-foreground text-sm">No note was entered.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
