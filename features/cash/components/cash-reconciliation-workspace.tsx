"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  confirmCashBalanceAction,
  overrideCashStartingBalanceAction,
  seedCashBalanceAction,
} from "@/actions/cash-reconciliation.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CashDenominationInput } from "@/features/cash/components/cash-denomination-input";
import { formatCurrency, formatVariance } from "@/lib/utils";
import type { cashReconciliationService } from "@/services/cash/cash-reconciliation.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

function toDateValue(date: Date): string {
  const d = new Date(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

type TodayBalance = NonNullable<
  Awaited<ReturnType<typeof cashReconciliationService.getOrCreateBalanceForDate>>
>;
type RecentBalances = Awaited<ReturnType<typeof cashReconciliationService.listRecentBalances>>;

interface CashReconciliationWorkspaceProps {
  needsSeed: boolean;
  todayBalance: TodayBalance | null;
  expectedEndingBalanceCents: number | null;
  recentBalances: RecentBalances;
}

function SeedBalanceForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [startingCash, setStartingCash] = useState("0");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const startingBalanceCents = Math.round(Number(startingCash) * 100);
    if (!Number.isFinite(startingBalanceCents)) {
      setServerError("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const result = await seedCashBalanceAction({ startingBalanceCents });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Cash reconciliation started.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up cash reconciliation</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-4 text-sm">
          No prior day exists yet — count the cash drawer/safe right now and enter the total to
          start tracking. Every day after this carries forward automatically; you won&apos;t need to
          do this again.
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="startingCash">Current cash on hand</Label>
            <CashDenominationInput
              id="startingCash"
              value={startingCash}
              onChange={setStartingCash}
            />
          </div>
          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Starting…" : "Start reconciliation"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OverrideStartingBalanceForm({ balance }: { balance: TodayBalance }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [newStartingCash, setNewStartingCash] = useState(
    String(balance.startingBalanceCents / 100),
  );
  const [reason, setReason] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const newStartingBalanceCents = Math.round(Number(newStartingCash) * 100);
    if (!Number.isFinite(newStartingBalanceCents)) {
      setServerError("Enter a valid amount.");
      return;
    }
    if (!reason.trim()) {
      setServerError("Enter a reason for this correction.");
      return;
    }

    startTransition(async () => {
      const result = await overrideCashStartingBalanceAction({
        date: toDateValue(balance.date),
        newStartingBalanceCents,
        reason: reason.trim(),
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Starting balance corrected.");
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="self-start"
      >
        Correct starting balance…
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-dashed p-3"
    >
      <p className="text-muted-foreground text-xs">
        Only if the physical count when the day started was different from what carried forward.
        Requires a reason — logged to the audit trail with the old and new value.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="newStartingCash">Corrected starting balance</Label>
        <CashDenominationInput
          id="newStartingCash"
          value={newStartingCash}
          onChange={setNewStartingCash}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="overrideReason">Reason (required)</Label>
        <Textarea
          id="overrideReason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
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

function ConfirmBalanceCard({
  balance,
  expectedEndingBalanceCents,
}: {
  balance: TodayBalance;
  expectedEndingBalanceCents: number;
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmedCash, setConfirmedCash] = useState("");
  const [withdrawnCash, setWithdrawnCash] = useState("0");
  const [notes, setNotes] = useState("");

  const confirmedCashCents = Math.round((Number(confirmedCash) || 0) * 100);
  const withdrawnCashCents = Math.round((Number(withdrawnCash) || 0) * 100);
  const varianceCents = confirmedCash.trim() ? confirmedCashCents - expectedEndingBalanceCents : 0;
  const hasVariance = confirmedCash.trim() !== "" && varianceCents !== 0;
  const carriedForwardCents = confirmedCashCents - withdrawnCashCents;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    if (!confirmedCash.trim()) {
      setServerError("Enter the confirmed cash balance.");
      return;
    }
    if (withdrawnCashCents < 0 || withdrawnCashCents > confirmedCashCents) {
      setServerError("Cash withdrawn can't be negative or more than the confirmed drawer count.");
      return;
    }
    if (hasVariance && !notes.trim()) {
      setServerError(
        "Confirmed balance doesn't match the expected amount — enter a note explaining the difference.",
      );
      return;
    }

    startTransition(async () => {
      const result = await confirmCashBalanceAction({
        date: toDateValue(balance.date),
        confirmedEndingBalanceCents: confirmedCashCents,
        withdrawnCents: withdrawnCashCents,
        notes: notes || undefined,
      });
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Cash balance confirmed.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{dateFormatter.format(balance.date)}</CardTitle>
        <Badge variant="status">Open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Starting balance</p>
            <p className="font-medium">{formatCurrency(balance.startingBalanceCents)}</p>
          </div>
        </div>

        <OverrideStartingBalanceForm balance={balance} />

        {/* Live — shown BEFORE the confirmed count, same reasoning as
            GCash reconciliation's own "Expected balance." */}
        <div className="bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
          <span className="text-muted-foreground">
            Expected balance (starting + today&apos;s cash sales)
          </span>
          <span className="font-semibold">{formatCurrency(expectedEndingBalanceCents)}</span>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirmedCash">Confirmed balance (count the drawer/safe)</Label>
            <CashDenominationInput
              id="confirmedCash"
              value={confirmedCash}
              onChange={setConfirmedCash}
            />
          </div>

          {confirmedCash.trim() ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Variance</span>
              <span
                className={
                  hasVariance ? "text-destructive font-semibold" : "text-success font-semibold"
                }
              >
                {formatVariance(varianceCents)}
              </span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="withdrawnCash">Cash withdrawn for bank/safe (optional)</Label>
            <Input
              id="withdrawnCash"
              type="number"
              step="0.01"
              min="0"
              value={withdrawnCash}
              onChange={(event) => setWithdrawnCash(event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              Whatever stays in the drawer becomes tomorrow&apos;s starting balance — not the full
              confirmed count.
            </p>
          </div>

          {confirmedCash.trim() ? (
            <div className="bg-muted/40 flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
              <span className="text-muted-foreground">Carries forward to tomorrow</span>
              <span className="font-semibold">{formatCurrency(carriedForwardCents)}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cashNotes">
              Notes{" "}
              {hasVariance ? (
                <span className="text-destructive">(required — there&apos;s a variance)</span>
              ) : (
                "(optional)"
              )}
            </Label>
            <Textarea
              id="cashNotes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>

          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Confirming…" : "Confirm balance"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function AlreadyConfirmedCard({ balance }: { balance: TodayBalance }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>{dateFormatter.format(balance.date)}</CardTitle>
        <Badge variant="outline">Confirmed</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Starting balance</span>
          <span className="font-medium">{formatCurrency(balance.startingBalanceCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Confirmed ending balance</span>
          <span className="font-medium">
            {balance.confirmedEndingBalanceCents != null
              ? formatCurrency(balance.confirmedEndingBalanceCents)
              : "—"}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Variance</span>
          <span
            className={
              balance.varianceCents ? "text-destructive font-medium" : "text-success font-medium"
            }
          >
            {formatVariance(balance.varianceCents ?? 0)}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Withdrawn for bank/safe</span>
          <span className="font-medium">{formatCurrency(balance.withdrawnCents)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Carried forward to next day</span>
          <span className="font-medium">
            {balance.confirmedEndingBalanceCents != null
              ? formatCurrency(balance.confirmedEndingBalanceCents - balance.withdrawnCents)
              : "—"}
          </span>
        </div>
        {balance.notes ? (
          <p className="text-muted-foreground mt-1">Notes: {balance.notes}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CashReconciliationWorkspace({
  needsSeed,
  todayBalance,
  expectedEndingBalanceCents,
  recentBalances,
}: CashReconciliationWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      {needsSeed || !todayBalance ? (
        <SeedBalanceForm />
      ) : todayBalance.status === "CONFIRMED" ? (
        <AlreadyConfirmedCard balance={todayBalance} />
      ) : (
        <ConfirmBalanceCard
          balance={todayBalance}
          expectedEndingBalanceCents={
            expectedEndingBalanceCents ?? todayBalance.startingBalanceCents
          }
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent days</CardTitle>
        </CardHeader>
        <CardContent>
          {recentBalances.length === 0 ? (
            <p className="text-muted-foreground text-sm">No days yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Starting</TableHead>
                  <TableHead>Confirmed ending</TableHead>
                  <TableHead>Withdrawn</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Confirmed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBalances.map((balance) => (
                  <TableRow key={balance.id}>
                    <TableCell className="font-medium">
                      {dateFormatter.format(balance.date)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={balance.status === "OPEN" ? "status" : "outline"}>
                        {balance.status === "OPEN" ? "Open" : "Confirmed"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(balance.startingBalanceCents)}</TableCell>
                    <TableCell>
                      {balance.confirmedEndingBalanceCents != null
                        ? formatCurrency(balance.confirmedEndingBalanceCents)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {balance.status === "CONFIRMED"
                        ? formatCurrency(balance.withdrawnCents)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {balance.varianceCents == null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            balance.varianceCents === 0
                              ? "text-success"
                              : "text-destructive font-medium"
                          }
                        >
                          {formatVariance(balance.varianceCents)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {balance.confirmedByEmployee
                        ? `${balance.confirmedByEmployee.firstName} ${balance.confirmedByEmployee.lastName}`
                        : "—"}
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
