"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { approveBookingPaymentProofAction, rejectBookingPaymentProofAction } from "@/actions/booking-payment-proof.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { getExpectedPaymentTotalCents } from "@/lib/booking-payment-total";
import { formatCurrency } from "@/lib/utils";
import type { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";

type Proof = NonNullable<Awaited<ReturnType<typeof bookingPaymentProofService.getProofById>>>;

interface PaymentVerificationDetailProps {
  proof: Proof;
  // Only ever non-null when this proof was APPROVED despite a mismatch
  // — read back from the audit log entry approveBookingPaymentProof
  // itself wrote (see the service's getApprovalOverrideReason). Not a
  // column on BookingPaymentProof.
  approvalOverrideReason: string | null;
}

export function PaymentVerificationDetail({ proof, approvalOverrideReason }: PaymentVerificationDetailProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [isApproving, startApprove] = useTransition();
  const [isRejecting, startReject] = useTransition();

  const courtCents = proof.booking.totalAmountCents ?? 0;
  const coachSession = proof.booking.coachSession;
  const coachCents = coachSession && coachSession.status !== "CANCELLED" ? coachSession.rateCents : 0;
  const expectedAmountCents = getExpectedPaymentTotalCents(proof.booking);
  const amountMismatches = proof.submittedAmountCents !== expectedAmountCents;

  function handleCopyReference() {
    if (!proof.gcashReference) {
      return;
    }
    navigator.clipboard
      .writeText(proof.gcashReference)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy — select and copy the reference manually."));
  }

  function handleCopyPhone() {
    const phone = proof.booking.guestPhone;
    if (!phone) {
      return;
    }
    navigator.clipboard
      .writeText(phone)
      .then(() => {
        setPhoneCopied(true);
        setTimeout(() => setPhoneCopied(false), 2000);
      })
      .catch(() => toast.error("Couldn't copy — select and copy the phone number manually."));
  }

  function handleApprove() {
    if (amountMismatches && !overrideReason.trim()) {
      toast.error("Enter a reason for approving a payment that doesn't match the expected amount.");
      return;
    }
    startApprove(async () => {
      const result = await approveBookingPaymentProofAction(
        proof.id,
        amountMismatches ? overrideReason.trim() : undefined,
      );
      if (result.error) {
        toast.error(result.error);
        return;
      }
      // The concurrency-awareness "equivalent check" (Gate 3): another
      // staff member may have already resolved this proof between page
      // load and this click (same race Gate 2 proved at the service
      // layer) — the action returns alreadyResolved rather than an
      // error, and the UI must say so plainly, not report a false
      // "you approved it" when someone else already did.
      if (result.alreadyResolved) {
        toast.info("Someone else already handled this payment.");
      } else {
        toast.success("Payment approved — booking confirmed.");
      }
      router.push("/dashboard/bookings/verify-payments");
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("Enter a reason for rejecting this payment.");
      return;
    }
    startReject(async () => {
      const result = await rejectBookingPaymentProofAction({ proofId: proof.id, reason: rejectReason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyResolved) {
        toast.info("Someone else already handled this payment.");
      } else {
        toast.success("Payment rejected — the customer can resubmit.");
      }
      router.push("/dashboard/bookings/verify-payments");
      router.refresh();
    });
  }

  const isPending = proof.status === "PENDING";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify payment</h1>
        <p className="text-muted-foreground text-sm">
          {proof.booking.court.name} ·{" "}
          {proof.booking.startAt.toLocaleString("en-PH", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}{" "}
          · {proof.booking.guestName ?? "—"}
        </p>
      </div>

      {!isPending ? (
        <div className="border-border bg-muted/30 rounded-lg border p-4 text-sm">
          <p className="font-medium">
            Already {proof.status === "APPROVED" ? "approved" : "rejected"}
            {proof.resolvedByEmployee
              ? ` by ${proof.resolvedByEmployee.firstName} ${proof.resolvedByEmployee.lastName}`
              : ""}
            .
          </p>
          {proof.rejectionReason ? (
            <p className="text-muted-foreground mt-1">Reason: {proof.rejectionReason}</p>
          ) : null}
          {proof.status === "APPROVED" && approvalOverrideReason ? (
            <p className="text-muted-foreground mt-1">
              Approved despite a mismatch — reason: {approvalOverrideReason}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Semaphore isn't wired yet (SMS_PROVIDER=console — see
          services/sms/sms-service.factory.ts) — every confirmation
          message is sent by a staff member manually until it is, so
          the customer's phone number has to be right here, easy to
          copy, next to the proof staff are verifying. */}
      <Card>
        <CardHeader>
          <CardTitle>Customer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{proof.booking.guestName ?? "—"}</span>
          </div>
          <button
            type="button"
            onClick={handleCopyPhone}
            disabled={!proof.booking.guestPhone}
            className="border-input hover:bg-accent flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="font-mono text-lg font-semibold tracking-wide select-all">
              {proof.booking.guestPhone ?? "No phone on file"}
            </span>
            {proof.booking.guestPhone ? (
              phoneCopied ? (
                <Check className="text-success size-5 shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              )
            ) : null}
          </button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>GCash reference</CardTitle>
        </CardHeader>
        <CardContent>
          <button
            type="button"
            onClick={handleCopyReference}
            disabled={!proof.gcashReference}
            className="border-input hover:bg-accent flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span className="font-mono text-2xl font-semibold tracking-wide select-all">
              {proof.gcashReference ?? "Not provided"}
            </span>
            {proof.gcashReference ? (
              copied ? (
                <Check className="text-success size-5 shrink-0" aria-hidden="true" />
              ) : (
                <Copy className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
              )
            ) : null}
          </button>
          <p className="text-muted-foreground mt-1.5 text-xs">
            {!proof.gcashReference
              ? "The customer didn't provide one — verify against the screenshot below."
              : copied
                ? "Copied."
                : "Tap to copy — paste into the GCash app to find this transaction."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Amount</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {coachCents > 0 ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Court hire</span>
                <span>{formatCurrency(courtCents)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Coaching{coachSession?.coach ? ` (${coachSession.coach.firstName} ${coachSession.coach.lastName})` : ""}
                </span>
                <span>{formatCurrency(coachCents)}</span>
              </div>
              <div className="border-border my-1 border-t" />
            </>
          ) : null}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Expected</span>
            <span className="font-medium">{formatCurrency(expectedAmountCents)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Submitted by customer</span>
            <span className="flex items-center gap-2 font-medium">
              {formatCurrency(proof.submittedAmountCents)}
              {amountMismatches ? <Badge variant="warning">Doesn&apos;t match</Badge> : null}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Screenshot</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Full size, not a thumbnail — staff need to actually read the
              amount and timestamp on it (§8). */}
          {/* eslint-disable-next-line @next/next/no-img-element -- served
              from an authenticated route, not a static/optimizable asset */}
          <img
            src={`/api/booking-payment-proof/${encodeURIComponent(proof.screenshotStorageKey)}`}
            alt="GCash payment confirmation screenshot"
            className="w-full rounded-lg border"
          />
        </CardContent>
      </Card>

      {isPending ? (
        <div className="flex flex-col gap-4">
          {amountMismatches ? (
            <Card>
              <CardHeader>
                <CardTitle>Reason for approving a mismatch</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-muted-foreground text-xs">
                  The submitted amount doesn&apos;t match the expected total. A benign mismatch
                  (rounding, a GCash send fee, a deliberate tip) is fine to approve — just say why.
                </p>
                <Textarea
                  placeholder="Why approve this mismatch? e.g. &quot;Customer rounded up ₱5&quot;"
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  disabled={isApproving || isRejecting}
                />
              </CardContent>
            </Card>
          ) : null}

          <Button
            type="button"
            onClick={handleApprove}
            disabled={isApproving || isRejecting || (amountMismatches && !overrideReason.trim())}
          >
            {isApproving ? "Approving…" : "Approve — confirm this booking"}
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>Reject</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Textarea
                placeholder="Why is this payment being rejected? The customer sees this."
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                disabled={isApproving || isRejecting}
              />
              <Button
                type="button"
                variant="destructive"
                onClick={handleReject}
                disabled={isApproving || isRejecting || !rejectReason.trim()}
                className="self-start"
              >
                {isRejecting ? "Rejecting…" : "Reject payment"}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
