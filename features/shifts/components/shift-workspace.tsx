"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { endShiftAction, startShiftAction } from "@/actions/shift.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CASH_DENOMINATIONS_PESOS, sumCashDenominationBreakdown } from "@/lib/cash-denominations";
import type { shiftService } from "@/services/shift/shift.service";
import { formatCurrency } from "@/lib/utils";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

type Shift = Awaited<ReturnType<typeof shiftService.getCurrentShift>>;
type RecentShifts = Awaited<ReturnType<typeof shiftService.listShifts>>;

interface ShiftWorkspaceProps {
  currentShift: Shift;
  recentShifts: RecentShifts;
  expectedCashCents: number | null;
}

function StartShiftForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [openingCash, setOpeningCash] = useState("0");
  const [openingNotes, setOpeningNotes] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const openingCashCents = Math.round(Number(openingCash) * 100);
    if (!Number.isFinite(openingCashCents)) {
      setServerError("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const result = await startShiftAction({
        openingCashCents,
        openingNotes: openingNotes || undefined,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Shift started.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Start your shift</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="openingCash">Opening cash</Label>
            <Input
              id="openingCash"
              type="number"
              step="0.01"
              min="0"
              value={openingCash}
              onChange={(event) => setOpeningCash(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="openingNotes">Opening notes (optional)</Label>
            <Textarea
              id="openingNotes"
              value={openingNotes}
              onChange={(event) => setOpeningNotes(event.target.value)}
            />
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Starting…" : "Start shift"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function EndShiftForm({ shift, expectedCashCents }: { shift: NonNullable<Shift>; expectedCashCents: number }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Gate 1: quantity per denomination, not one manual total — keyed by
  // the raw &lt;input&gt; string value (denomination -> what staff typed),
  // parsed/summed via the same sumCashDenominationBreakdown the server
  // uses, so the live preview here can never disagree with what
  // actually gets computed and persisted.
  const [denominationCounts, setDenominationCounts] = useState<Record<string, string>>({});
  const [closingNotes, setClosingNotes] = useState("");

  const breakdown = Object.fromEntries(
    Object.entries(denominationCounts).map(([denomination, value]) => [denomination, Number(value) || 0]),
  );
  const closingCashCents = sumCashDenominationBreakdown(breakdown);
  const varianceCents = closingCashCents - expectedCashCents;
  const hasVariance = varianceCents !== 0;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (hasVariance && !closingNotes.trim()) {
      setServerError("Counted cash doesn't match the expected amount — enter a note explaining the difference.");
      return;
    }

    startTransition(async () => {
      const result = await endShiftAction(shift.id, {
        closingCashBreakdown: breakdown,
        closingNotes: closingNotes || undefined,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Shift ended.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Current shift</CardTitle>
        {/* BUILD-SPEC.md §2 — this is genuine record-active status (the
            shift IS open right now), so it gets the dedicated status
            color, not the action-button green, consistently with every
            other "active" indicator in the dashboard. */}
        <Badge variant="status">Open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
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
        </div>

        {/* Gate 1: shown BEFORE the count — opening cash + cash sales
            rung up so far this shift, so closing is a real comparison,
            not a blind entry. */}
        <div className="bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span className="text-muted-foreground">Expected cash (opening + cash sales so far)</span>
          <span className="font-semibold">{formatCurrency(expectedCashCents)}</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-2">
            <Label>Cash count</Label>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              {CASH_DENOMINATIONS_PESOS.map((denomination) => (
                <div key={denomination} className="flex items-center gap-2">
                  <Label htmlFor={`denom-${denomination}`} className="w-16 shrink-0 font-mono text-xs">
                    ₱{denomination}
                  </Label>
                  <Input
                    id={`denom-${denomination}`}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    placeholder="0"
                    value={denominationCounts[String(denomination)] ?? ""}
                    onChange={(event) =>
                      setDenominationCounts((current) => ({ ...current, [String(denomination)]: event.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 border-t pt-3 text-sm">
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

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="closingNotes">
              Closing notes {hasVariance ? <span className="text-destructive">(required — there&apos;s a variance)</span> : "(optional)"}
            </Label>
            <Textarea
              id="closingNotes"
              value={closingNotes}
              onChange={(event) => setClosingNotes(event.target.value)}
            />
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" variant="destructive" disabled={isPending}>
            {isPending ? "Ending…" : "End shift"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function ShiftWorkspace({ currentShift, recentShifts, expectedCashCents }: ShiftWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      {currentShift ? (
        <EndShiftForm shift={currentShift} expectedCashCents={expectedCashCents ?? currentShift.openingCashCents} />
      ) : (
        <StartShiftForm />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent shifts</CardTitle>
        </CardHeader>
        <CardContent>
          {recentShifts.length === 0 ? (
            <p className="text-muted-foreground text-sm">No shifts yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Shift</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opening</TableHead>
                  <TableHead>Closing</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentShifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">
                      {/* Gap #4 fix: only a CLOSED shift has anything to
                          show past what's already in this row (denomination
                          breakdown, closing note) — the currently-open
                          shift is already fully visible in the card above,
                          so it stays plain text here rather than linking
                          somewhere with nothing new to say. */}
                      {shift.status === "CLOSED" ? (
                        <Link href={`/dashboard/shift/${shift.id}`} className="hover:underline">
                          {shift.shiftNumber}
                        </Link>
                      ) : (
                        shift.shiftNumber
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={shift.status === "OPEN" ? "status" : "outline"}>
                        {shift.status === "OPEN" ? "Open" : "Closed"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(shift.openingCashCents)}</TableCell>
                    <TableCell>
                      {shift.closingCashCents != null ? formatCurrency(shift.closingCashCents) : "—"}
                    </TableCell>
                    <TableCell>
                      {shift.varianceCents == null ? (
                        "—"
                      ) : shift.varianceCents === 0 ? (
                        <span className="text-success">₱0.00</span>
                      ) : (
                        <span className="text-destructive font-medium">
                          {shift.varianceCents > 0 ? "+" : ""}
                          {formatCurrency(shift.varianceCents)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{dateTimeFormatter.format(shift.startedAt)}</TableCell>
                    <TableCell>
                      {shift.endedAt ? dateTimeFormatter.format(shift.endedAt) : "—"}
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
