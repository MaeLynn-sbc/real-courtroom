"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cancelRegistrationAction,
  deleteRegistrationAction,
  markNoShowAction,
  refundRegistrationAction,
} from "@/actions/open-play-registration.actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

interface RosterRegistration {
  id: string;
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  status: string;
  waitlistPos: number | null;
  date: Date;
  registeredAt: Date;
}

function formatNightDate(date: Date): string {
  return date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
}

function formatRegisteredAt(date: Date): string {
  return date.toLocaleString("en-PH", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

interface RegistrationRosterPanelProps {
  registrations: RosterRegistration[];
  skillBreakdown: Record<OpenPlaySkillLevel, number>;
  capacity: number;
}

function RowActions({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(action: (input: { registrationId: string }) => Promise<{ error: string | null }>, label: string) {
    startTransition(async () => {
      const result = await action({ registrationId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(label);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-1.5">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={isPending}
        onClick={() => run(markNoShowAction, "Marked no-show.")}
      >
        No-show
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => run(cancelRegistrationAction, "Registration cancelled.")}
      >
        Cancel
      </Button>
    </div>
  );
}

// Cancellation policy Gate 1 — staff refund path (BUILD-SPEC.md's "Staff-
// initiated refunds must exist, separately"). Genuine business-error cash
// back, not the customer-facing credit path (that's automatic, inside
// releaseRegistration) — shown for CONFIRMED, CANCELLED, or REJECTED
// registrations, since all three are real scenarios a refund applies to
// (a wrongly-rejected valid payment, a genuine double payment, a staff-
// cancelled night). Same toggle-open-small-form shape as GCash
// reconciliation's OverrideStartingBalanceForm.
function RefundAction({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("150");
  const [reason, setReason] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Refund
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`refund-amount-${registrationId}`} className="text-muted-foreground text-xs">
          Amount (₱)
        </Label>
        <Input
          id={`refund-amount-${registrationId}`}
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`refund-reason-${registrationId}`} className="text-muted-foreground text-xs">
          Reason (required)
        </Label>
        <Textarea
          id={`refund-reason-${registrationId}`}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
      {serverError ? (
        <p className="text-destructive text-xs" role="alert">
          {serverError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={isPending}
          onClick={() => {
            setServerError(null);
            const amountCents = Math.round(Number(amount) * 100);
            if (!Number.isFinite(amountCents) || amountCents <= 0) {
              setServerError("Enter a valid amount.");
              return;
            }
            if (!reason.trim()) {
              setServerError("Enter a reason for this refund.");
              return;
            }
            startTransition(async () => {
              const result = await refundRegistrationAction({ registrationId, amountCents, reason: reason.trim() });
              if (result.error) {
                setServerError(result.error);
                return;
              }
              toast.success("Refund recorded.");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          {isPending ? "Saving…" : "Save refund"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Reported live: leftover test registrations (AWAITING_PAYMENT/
// PENDING_VERIFICATION/NO_SHOW/CANCELLED/REJECTED rows made while trying
// out the public form) had no cleanup path short of direct database
// access. Only rendered for those statuses (never CONFIRMED/CHECKED_OUT —
// deleteRegistrationAction's own guard blocks those server-side too, this
// just keeps the button from ever appearing for a real seat). Confirm
// dialog since this is a hard, irreversible delete, unlike Cancel/No-show.
function DeleteAction({ registrationId, playerName }: { registrationId: string; playerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {playerName}&apos;s registration?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the registration — there&apos;s no undo. Use this for test or mistaken
              entries only; a real registration that already showed up or paid can&apos;t be deleted this way.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteRegistrationAction({ registrationId });
                  if (result.error) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success("Registration deleted.");
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function RegistrationRosterPanel({ registrations, skillBreakdown, capacity }: RegistrationRosterPanelProps) {
  const seated = registrations.filter((r) => r.status === "CONFIRMED" && r.waitlistPos === null);
  const waitlisted = registrations.filter((r) => r.waitlistPos !== null);
  const active = registrations.filter((r) => r.status === "CONFIRMED");

  const breakdownText = OPEN_PLAY_SKILL_LEVEL_ORDER.map(
    (level) => `${skillBreakdown[level]} ${OPEN_PLAY_SKILL_LEVELS[level].label.toLowerCase()}`,
  ).join(" · ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Roster</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-medium">
            {seated.length} / {capacity} · {waitlisted.length} waiting
          </span>
          {active.length > 0 ? <span className="text-muted-foreground">{breakdownText}</span> : null}
        </div>

        {registrations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No registrations yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Night</TableHead>
                <TableHead>Registered</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {registrations.map((registration) => (
                <TableRow key={registration.id}>
                  <TableCell className="font-medium">{registration.playerName}</TableCell>
                  <TableCell>{registration.phone}</TableCell>
                  <TableCell>{OPEN_PLAY_SKILL_LEVELS[registration.skillLevel].label}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatNightDate(registration.date)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{formatRegisteredAt(registration.registeredAt)}</TableCell>
                  <TableCell>
                    {registration.status !== "CONFIRMED" ? (
                      <Badge variant="destructive">{registration.status.replace("_", " ")}</Badge>
                    ) : registration.waitlistPos !== null ? (
                      // Owner decision (Fri/Sat waitlist rework): a
                      // waitlisted walk-in is registered at zero charge —
                      // "Unpaid" here is that fact, not a warning about a
                      // missed payment. Pays at the desk only once
                      // promoted into a real seat.
                      <Badge variant="warning">Waitlist #{registration.waitlistPos} · Unpaid</Badge>
                    ) : (
                      // BUILD-SPEC.md §2 — status/active, not action green;
                      // a roster table, not a record-card list.
                      <Badge variant="status">Confirmed · Paid</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1.5">
                      {registration.status === "CONFIRMED" ? <RowActions registrationId={registration.id} /> : null}
                      {registration.status === "CONFIRMED" ||
                      registration.status === "CANCELLED" ||
                      registration.status === "REJECTED" ? (
                        <RefundAction registrationId={registration.id} />
                      ) : null}
                      {registration.status !== "CONFIRMED" && registration.status !== "CHECKED_OUT" ? (
                        <DeleteAction registrationId={registration.id} playerName={registration.playerName} />
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
