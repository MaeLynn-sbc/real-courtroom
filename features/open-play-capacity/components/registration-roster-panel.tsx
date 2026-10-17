"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cancelRegistrationAction,
  deleteRegistrationAction,
  collectRegistrationFeeAction,
  markNoShowAction,
  seatFromWaitlistAction,
  undoCheckOutAction,
  refundRegistrationAction,
} from "@/actions/open-play-registration.actions";
import { deriveSettlementMethod, SettlementPaymentFields } from "@/components/shared/settlement-payment-fields";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { isRegistrationOccupyingSeat, OPEN_PLAY_HOLD_MINUTES } from "@/lib/open-play-seats";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";
import {
  OPEN_PLAY_SKILL_LEVEL_ORDER,
  OPEN_PLAY_SKILL_LEVELS,
} from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

interface RosterRegistration {
  id: string;
  // A sale or a redeemed credit is recorded for the ₱150. False for a
  // walk-in seated from the waitlist until someone takes the payment.
  isPaid: boolean;
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  status: string;
  waitlistPos: number | null;
  holdExpiresAt: Date | null;
  date: Date;
  registeredAt: Date;
  // "Viewable after approval" (reported live): the roster used to have
  // no link at all into a submitted payment proof, pending or resolved
  // — the detail page itself already handles every status, so this is
  // just wiring a link to it. At most one row (getSessionRegistrations'
  // own take: 1, most recent submission first).
  paymentProofs: {
    id: string;
    status: string;
    resolvedByEmployee: { firstName: string; lastName: string } | null;
  }[];
}

const PROOF_STATUS_BADGE_VARIANT: Record<string, "status" | "warning" | "destructive"> = {
  PENDING: "warning",
  APPROVED: "status",
  REJECTED: "destructive",
};

function ProofLink({
  proof,
}: {
  proof: {
    id: string;
    status: string;
    resolvedByEmployee: { firstName: string; lastName: string } | null;
  };
}) {
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Link
        href={`/dashboard/admin/open-play-capacity/verify-payments/${proof.id}`}
        className="inline-flex"
      >
        <Badge
          variant={PROOF_STATUS_BADGE_VARIANT[proof.status] ?? "status"}
          className="cursor-pointer"
        >
          Proof ·{" "}
          {proof.status === "APPROVED"
            ? "Approved"
            : proof.status === "REJECTED"
              ? "Rejected"
              : "Pending"}
        </Badge>
      </Link>
      {proof.resolvedByEmployee ? (
        <span className="text-muted-foreground text-xs">
          by {proof.resolvedByEmployee.firstName} {proof.resolvedByEmployee.lastName}
        </span>
      ) : null}
    </div>
  );
}

function formatNightDate(date: Date): string {
  return date.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" });
}

function formatRegisteredAt(date: Date): string {
  return date.toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface RegistrationRosterPanelProps {
  registrations: RosterRegistration[];
  skillBreakdown: Record<OpenPlaySkillLevel, number>;
  capacity: number;
  seatsRemaining: number;
  paymentMethods: SettlementPaymentMethodOption[];
  friSatRegistrationFeeCents: number;
  // Website registrants who found the night full (owner, 2026-10-16:
  // seven on Oct 16, invisible anywhere on the dashboard). They get an
  // automatic invite when a seat frees; staff can also just call them.
  onlineWaitlist?: {
    id: string;
    playerName: string;
    phone: string;
    skillLevel: OpenPlaySkillLevel;
    status: "WAITING" | "INVITED";
    submittedAt: Date;
    inviteExpiresAt: Date | null;
  }[];
}

// What the Seat now / Take payment forms need, threaded through the table
// and the phone cards alike.
interface PaymentSetup {
  seatsRemaining: number;
  paymentMethods: SettlementPaymentMethodOption[];
  feeCents: number;
}

function RowActions({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function run(
    action: (input: { registrationId: string }) => Promise<{ error: string | null }>,
    label: string,
  ) {
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

// Shared by the desktop table and the phone cards below.
function RegistrationStatusBadge({ registration }: { registration: RosterRegistration }) {
  if (registration.status !== "CONFIRMED") {
    return <Badge variant="destructive">{registration.status.replace("_", " ")}</Badge>;
  }
  if (registration.waitlistPos === null && !registration.isPaid) {
    // Seated from the waitlist (or registered while the night looked
    // full) — has a seat, no payment recorded yet.
    return <Badge variant="warning">Seated · Unpaid</Badge>;
  }
  if (registration.waitlistPos !== null) {
    // Owner decision (Fri/Sat waitlist rework): a waitlisted walk-in is
    // registered at zero charge — "Unpaid" here is that fact, not a
    // warning about a missed payment. Pays at the desk only once promoted
    // into a real seat.
    return <Badge variant="warning">Waitlist #{registration.waitlistPos} · Unpaid</Badge>;
  }
  // BUILD-SPEC.md §2 — status/active, not action green.
  return <Badge variant="status">Confirmed · Paid</Badge>;
}

function RegistrationActions({
  registration,
  payment,
}: {
  registration: RosterRegistration;
  payment: PaymentSetup;
}) {
  const isConfirmed = registration.status === "CONFIRMED";
  return (
    <div className="flex flex-wrap items-start gap-1.5 md:flex-col">
      {registration.paymentProofs[0] ? <ProofLink proof={registration.paymentProofs[0]} /> : null}
      {isConfirmed && registration.waitlistPos !== null ? (
        <PaymentAction mode="seat" registration={registration} payment={payment} />
      ) : null}
      {isConfirmed && registration.waitlistPos === null && !registration.isPaid ? (
        <PaymentAction mode="collect" registration={registration} payment={payment} />
      ) : null}
      {isConfirmed ? <RowActions registrationId={registration.id} /> : null}
      {registration.status === "CHECKED_OUT" ? (
        <UndoCheckOutAction registrationId={registration.id} />
      ) : null}
      {/* Nothing to refund on an unpaid waitlist or unpaid seat. */}
      {(isConfirmed && registration.isPaid) ||
      registration.status === "CANCELLED" ||
      registration.status === "REJECTED" ? (
        <RefundAction registrationId={registration.id} />
      ) : null}
      {registration.status !== "CONFIRMED" && registration.status !== "CHECKED_OUT" ? (
        <DeleteAction registrationId={registration.id} playerName={registration.playerName} />
      ) : null}
    </div>
  );
}

// Owner (2026-10-10). "seat": put a waitlisted walk-in into a free seat and
// take the ₱150 at the same moment — the only way to do that used to be a
// cancel and re-register. "collect": a walk-in already seated from the
// waitlist, payment not yet taken.
function PaymentAction({
  mode,
  registration,
  payment,
}: {
  mode: "seat" | "collect";
  registration: RosterRegistration;
  payment: PaymentSetup;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [gcashReference, setGcashReference] = useState("");
  const [isPending, startTransition] = useTransition();
  const noSeat = mode === "seat" && payment.seatsRemaining <= 0;
  const label = mode === "seat" ? "Seat now" : "Take payment";

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant={mode === "collect" ? "default" : "outline"}
        disabled={noSeat}
        title={noSeat ? "Every seat is taken — raise the night's capacity first." : undefined}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
    );
  }

  function confirm() {
    const method = deriveSettlementMethod(payment.paymentMethods, paymentMethodId);
    if (!method) {
      toast.error("Select a payment method.");
      return;
    }
    if (method === "GCASH" && !gcashReference.trim()) {
      toast.error("Enter the GCash reference number.");
      return;
    }
    startTransition(async () => {
      const input = {
        registrationId: registration.id,
        method,
        gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
        paymentMethodId,
      };
      const result = mode === "seat" ? await seatFromWaitlistAction(input) : await collectRegistrationFeeAction(input);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        mode === "seat" ? `${registration.playerName} seated and paid.` : `Payment recorded for ${registration.playerName}.`,
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed p-2">
      <SettlementPaymentFields
        paymentMethods={payment.paymentMethods}
        paymentMethodId={paymentMethodId}
        onPaymentMethodIdChange={setPaymentMethodId}
        gcashReference={gcashReference}
        onGcashReferenceChange={setGcashReference}
        idPrefix={`${mode}-${registration.id}`}
        amountCents={payment.feeCents}
      />
      <div className="flex gap-1.5">
        <Button type="button" size="sm" disabled={isPending} onClick={confirm}>
          {isPending ? "Saving…" : mode === "seat" ? "Seat and record payment" : "Record payment"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// Owner request (2026-10-03): a check-out tapped by mistake had no way back.
function UndoCheckOutAction({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isPending}
      onClick={() =>
        startTransition(async () => {
          const result = await undoCheckOutAction({ registrationId });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Check-out undone.");
          router.refresh();
        })
      }
    >
      {isPending ? "Undoing…" : "Undo check-out"}
    </Button>
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
        <Label
          htmlFor={`refund-amount-${registrationId}`}
          className="text-muted-foreground text-xs"
        >
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
        <Label
          htmlFor={`refund-reason-${registrationId}`}
          className="text-muted-foreground text-xs"
        >
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
              const result = await refundRegistrationAction({
                registrationId,
                amountCents,
                reason: reason.trim(),
              });
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={isPending}
          onClick={() => setOpen(false)}
        >
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
function DeleteAction({
  registrationId,
  playerName,
}: {
  registrationId: string;
  playerName: string;
}) {
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
              This permanently removes the registration — there&apos;s no undo. Use this for test or
              mistaken entries only; a real registration that already showed up or paid can&apos;t
              be deleted this way.
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

export function RegistrationRosterPanel({
  registrations,
  skillBreakdown,
  capacity,
  seatsRemaining,
  paymentMethods,
  friSatRegistrationFeeCents,
  onlineWaitlist = [],
}: RegistrationRosterPanelProps) {
  const paymentSetup: PaymentSetup = { seatsRemaining, paymentMethods, feeCents: friSatRegistrationFeeCents };
  // Same occupied-seat predicate the capacity page's header now uses
  // (lib/open-play-seats.ts) — this used to be a narrower, silently
  // drifted "CONFIRMED only" count that disagreed with the canonical
  // definition (excluded PENDING_VERIFICATION and live AWAITING_PAYMENT
  // holds). Two numbers for "how many seats are taken" on the same page
  // is worse than one, even a correct one.
  const seated = registrations.filter((r) => isRegistrationOccupyingSeat(r, new Date()));
  // Live online holds — counted in `seated` (the seat is reserved), but
  // not paid yet. Shown separately so staff can tell (owner, 2026-10-17).
  const unpaidHolds = seated.filter((r) => r.status === "AWAITING_PAYMENT");
  const latestHoldEnd = unpaidHolds.reduce<Date | null>(
    (latest, r) => (r.holdExpiresAt && (!latest || r.holdExpiresAt > latest) ? r.holdExpiresAt : latest),
    null,
  );
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
            {seated.length} / {capacity}
            {unpaidHolds.length > 0
              ? ` (${seated.length - unpaidHolds.length} paid · ${unpaidHolds.length} holding, unpaid${
                  latestHoldEnd
                    ? ` until ${new Date(latestHoldEnd).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
                    : ""
                })`
              : ""}{" "}
            · {waitlisted.length} waiting at the desk
            {onlineWaitlist.length > 0 ? ` · ${onlineWaitlist.length} on the online waitlist` : ""}
          </span>
          {active.length > 0 ? (
            <span className="text-muted-foreground">{breakdownText}</span>
          ) : null}
        </div>

        {registrations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No registrations yet.</p>
        ) : (
          <>
            {/* Phones: one card per player, actions visible without
                scrolling sideways (2026-10-05 mobile audit — in the
                table they sat in the 7th column, off-screen). */}
            <ul className="flex flex-col gap-3 md:hidden">
              {registrations.map((registration) => (
                <li key={registration.id} className="flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{registration.playerName}</p>
                      <p className="text-muted-foreground text-sm">
                        {registration.phone} ·{" "}
                        {OPEN_PLAY_SKILL_LEVELS[registration.skillLevel].label}
                      </p>
                    </div>
                    <RegistrationStatusBadge registration={registration} />
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatNightDate(registration.date)} · registered{" "}
                    {formatRegisteredAt(registration.registeredAt)}
                  </p>
                  <RegistrationActions registration={registration} payment={paymentSetup} />
                </li>
              ))}
            </ul>

            <div className="hidden md:block">
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
                      <TableCell className="text-muted-foreground text-sm">
                        {formatNightDate(registration.date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatRegisteredAt(registration.registeredAt)}
                      </TableCell>
                      <TableCell>
                        <RegistrationStatusBadge registration={registration} />
                      </TableCell>
                      <TableCell>
                        <RegistrationActions registration={registration} payment={paymentSetup} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
        {onlineWaitlist.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div>
              <h3 className="text-sm font-medium">Online waitlist ({onlineWaitlist.length})</h3>
              <p className="text-muted-foreground text-xs">
                Registered on the website while the night was full — not charged. When a seat frees up and nobody is
                waiting at the desk, the first person here gets a text and {OPEN_PLAY_HOLD_MINUTES} minutes to pay. You can also call them.
              </p>
            </div>
            <ol className="flex flex-col gap-1.5">
              {onlineWaitlist.map((entry, index) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="text-muted-foreground mr-2">#{index + 1}</span>
                    <span className="font-medium">{entry.playerName}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · <a href={`tel:${entry.phone}`} className="underline">{entry.phone}</a> ·{" "}
                      {OPEN_PLAY_SKILL_LEVELS[entry.skillLevel].label} · joined {formatRegisteredAt(entry.submittedAt)}
                    </span>
                  </span>
                  {entry.status === "INVITED" ? (
                    <Badge variant="warning">
                      Offered a seat
                      {entry.inviteExpiresAt
                        ? ` · pay by ${new Date(entry.inviteExpiresAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Waiting · not charged</Badge>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
