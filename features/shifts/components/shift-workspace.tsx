"use client";

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
import type { shiftService } from "@/services/shift/shift.service";
import { formatCurrency } from "@/lib/utils";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

type Shift = Awaited<ReturnType<typeof shiftService.getCurrentShift>>;
type RecentShifts = Awaited<ReturnType<typeof shiftService.listShifts>>;

interface ShiftWorkspaceProps {
  currentShift: Shift;
  recentShifts: RecentShifts;
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

function EndShiftForm({ shift }: { shift: NonNullable<Shift> }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [closingCash, setClosingCash] = useState("0");
  const [closingNotes, setClosingNotes] = useState("");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const closingCashCents = Math.round(Number(closingCash) * 100);
    if (!Number.isFinite(closingCashCents)) {
      setServerError("Enter a valid amount.");
      return;
    }

    startTransition(async () => {
      const result = await endShiftAction(shift.id, {
        closingCashCents,
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
        <Badge variant="success">Open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
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
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="closingCash">Closing cash</Label>
            <Input
              id="closingCash"
              type="number"
              step="0.01"
              min="0"
              value={closingCash}
              onChange={(event) => setClosingCash(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="closingNotes">Closing notes (optional)</Label>
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

export function ShiftWorkspace({ currentShift, recentShifts }: ShiftWorkspaceProps) {
  return (
    <div className="flex flex-col gap-6">
      {currentShift ? <EndShiftForm shift={currentShift} /> : <StartShiftForm />}

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
                  <TableHead>Started</TableHead>
                  <TableHead>Ended</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentShifts.map((shift) => (
                  <TableRow key={shift.id}>
                    <TableCell className="font-medium">{shift.shiftNumber}</TableCell>
                    <TableCell>
                      <Badge variant={shift.status === "OPEN" ? "success" : "outline"}>
                        {shift.status === "OPEN" ? "Open" : "Closed"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatCurrency(shift.openingCashCents)}</TableCell>
                    <TableCell>
                      {shift.closingCashCents != null ? formatCurrency(shift.closingCashCents) : "—"}
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
