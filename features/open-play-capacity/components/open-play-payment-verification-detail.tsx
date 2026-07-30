"use client";

import { Check, Copy } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveOpenPlayRegistrationPaymentProofAction,
  recordOpenPlayRegistrationPaymentProofReferenceAction,
  rejectOpenPlayRegistrationPaymentProofAction,
} from "@/actions/open-play-registration-payment-proof.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/utils";
import { OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";

type Proof = NonNullable<Awaited<ReturnType<typeof openPlayRegistrationPaymentProofService.getProofById>>>;

interface OpenPlayPaymentVerificationDetailProps {
  proof: Proof;
  expectedAmountCents: number;
}

// Own screen, not a merged view with booking's queue — different linked
// record (OpenPlayNightRegistration, no court/time), different expected-
// amount source (a live settings value, not a per-row snapshotted
// column), and per Gate 1's own recommendation, unconditionally joining
// booking.court the way that queue does would make no sense here. Same
// visual language and interaction shape otherwise — this file mirrors
// features/bookings/components/payment-verification-detail.tsx closely
// on purpose.
export function OpenPlayPaymentVerificationDetail({ proof, expectedAmountCents }: OpenPlayPaymentVerificationDetailProps) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [isApproving, startApprove] = useTransition();
  const [isRejecting, startReject] = useTransition();
  // Staff-side replacement for the reference removed from the customer
  // upload — recorded manually here, at verification, if staff need one.
  const [manualReference, setManualReference] = useState("");
  const [isRecordingReference, startRecordReference] = useTransition();

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

  function handleRecordReference() {
    if (!manualReference.trim()) {
      return;
    }
    startRecordReference(async () => {
      const result = await recordOpenPlayRegistrationPaymentProofReferenceAction({
        proofId: proof.id,
        gcashReference: manualReference,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Reference recorded.");
      router.refresh();
    });
  }

  function handleApprove() {
    startApprove(async () => {
      const result = await approveOpenPlayRegistrationPaymentProofAction(proof.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyResolved) {
        toast.info("Someone else already handled this payment.");
      } else {
        toast.success("Payment approved — registration confirmed.");
      }
      router.push("/dashboard/admin/open-play-capacity/verify-payments");
      router.refresh();
    });
  }

  function handleReject() {
    if (!rejectReason.trim()) {
      toast.error("Enter a reason for rejecting this payment.");
      return;
    }
    startReject(async () => {
      const result = await rejectOpenPlayRegistrationPaymentProofAction({ proofId: proof.id, reason: rejectReason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (result.alreadyResolved) {
        toast.info("Someone else already handled this payment.");
      } else {
        toast.success("Payment rejected — the customer has been notified.");
      }
      router.push("/dashboard/admin/open-play-capacity/verify-payments");
      router.refresh();
    });
  }

  const isPending = proof.status === "PENDING";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify open-play payment</h1>
        <p className="text-muted-foreground text-sm">
          {proof.registration.playerName} · {proof.registration.phone} ·{" "}
          {OPEN_PLAY_SKILL_LEVELS[proof.registration.skillLevel].label} ·{" "}
          {proof.registration.date.toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric" })}
        </p>
      </div>

      {!isPending ? (
        <div className="border-border bg-muted/30 rounded-lg border p-4 text-sm">
          <p className="font-medium">
            Already {proof.status === "APPROVED" ? "approved" : "rejected"}
            {proof.resolvedByEmployee ? ` by ${proof.resolvedByEmployee.firstName} ${proof.resolvedByEmployee.lastName}` : ""}.
          </p>
          {proof.rejectionReason ? <p className="text-muted-foreground mt-1">Reason: {proof.rejectionReason}</p> : null}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>GCash reference</CardTitle>
        </CardHeader>
        <CardContent>
          {proof.gcashReference ? (
            <>
              <button
                type="button"
                onClick={handleCopyReference}
                className="border-input hover:bg-accent flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
              >
                <span className="font-mono text-2xl font-semibold tracking-wide select-all">
                  {proof.gcashReference}
                </span>
                {copied ? (
                  <Check className="text-success size-5 shrink-0" aria-hidden="true" />
                ) : (
                  <Copy className="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
                )}
              </button>
              <p className="text-muted-foreground mt-1.5 text-xs">
                {copied ? "Copied." : "Tap to copy — paste into the GCash app to find this transaction."}
              </p>
            </>
          ) : isPending ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  value={manualReference}
                  onChange={(event) => setManualReference(event.target.value)}
                  placeholder="Not provided — enter one if you have it"
                  className="font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isRecordingReference || !manualReference.trim()}
                  onClick={handleRecordReference}
                >
                  {isRecordingReference ? "Saving…" : "Save"}
                </Button>
              </div>
              <p className="text-muted-foreground mt-1.5 text-xs">
                The customer didn&apos;t provide one — verify against the screenshot below. Optional; record
                one here if you have it (e.g. read it off the screenshot, or ask the customer).
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Not provided.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Amount</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
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
          {/* eslint-disable-next-line @next/next/no-img-element -- served from an authenticated route, not a static/optimizable asset */}
          <img
            src={`/api/open-play-registration-payment-proof/${encodeURIComponent(proof.screenshotStorageKey)}`}
            alt="GCash payment confirmation screenshot"
            className="w-full rounded-lg border"
          />
        </CardContent>
      </Card>

      {isPending ? (
        <div className="flex flex-col gap-4">
          <Button type="button" onClick={handleApprove} disabled={isApproving || isRejecting}>
            {isApproving ? "Approving…" : "Approve — confirm this registration"}
          </Button>

          <Card>
            <CardHeader>
              <CardTitle>Reject</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Textarea
                placeholder="Why is this payment being rejected? The customer sees this by SMS."
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
