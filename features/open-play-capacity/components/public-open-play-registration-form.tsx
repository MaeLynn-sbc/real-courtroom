"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { cancelPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration-cancellation.actions";
import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import { submitPublicOpenPlayRegistrationPaymentProofAction } from "@/actions/public-open-play-registration-payment-proof.actions";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OpenPlayRegistrationProofForm } from "@/features/open-play-capacity/components/open-play-registration-proof-form";
import {
  OPEN_PLAY_SKILL_LEVEL_ORDER,
  OPEN_PLAY_SKILL_LEVELS,
} from "@/types/open-play-skill-levels";
import { cn } from "@/lib/utils";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

// Mirrors OpenPlayRegistrationProofForm's own fileToBase64 (that file's
// comment explains why: same file -> base64 -> action shape as
// record-gcash-payment-form.tsx, an established, already-duplicated
// pattern in this codebase rather than a shared cross-module helper).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function remainingSeatsLabel(remaining: number): string {
  if (remaining <= 0) return "Full";
  return `${remaining} spot${remaining === 1 ? "" : "s"} left`;
}

export interface PublicOpenPlayNight {
  date: string; // "YYYY-MM-DD"
  label: string; // "Fri, Aug 1"
  // Reported live: the home page's Friday/Saturday cards already show
  // remaining seats before someone clicks through, but this page — where
  // someone actually registers — didn't, so there was no way to tell
  // whether you were taking one of the last seats or one of thirty.
  // Same computeRemainingSeats(capacity, registeredCount) the home page
  // uses, computed once in page.tsx from the same getUpcomingNights data
  // both pages already fetch — never a second, independent count.
  remainingSeats: number;
}

interface PublicOpenPlayRegistrationFormValues {
  playerName: string;
  phone: string;
  skillLevel: OpenPlaySkillLevel;
  date: string;
}

// Same single-component, internal-state-transition shape as
// PublicBookingForm — no separate pages. Three outcomes beyond the
// plain form, though, not one: waitlisted (nothing more to do but
// wait for an SMS), not-yet-open (a date too far out), and registered
// (which — unlike Booking's own "call the desk" stopgap — moves
// straight into a real self-service proof-upload step, this app's
// first one).
//
// Reported live: staff were seeing repeat AWAITING_PAYMENT holds with
// no proof ever submitted — people clicking "Register," seeing "Slot
// held," and walking away thinking that was the whole process, never
// realizing a second step (the screenshot) was still needed. Fix: the
// screenshot is now collected in the SAME form/click as "Register," so
// the two service calls (create hold, then submit proof) fire back to
// back with nothing for a customer to abandon in between. awaitingProof
// is kept only as the FALLBACK path — reached if the hold was created
// but the immediately-following proof submission itself failed (upload
// error, etc.) — so nobody who already has a hold is ever stuck with no
// way to finish; same manual retry UI as before, just no longer the
// golden path.
type Step =
  | { kind: "form" }
  | { kind: "waitlisted" }
  | { kind: "not-yet-open"; opensAt: string }
  | {
      kind: "awaiting-proof";
      registrationId: string;
      playerName: string;
      proofFailedMessage?: string;
    }
  | { kind: "proof-submitted" };

export function PublicOpenPlayRegistrationForm({
  nights,
  registrationFeeCents,
  lockedDate,
  gcashInfo,
  contactPhone,
  contactFacebookUrl,
}: {
  nights: PublicOpenPlayNight[];
  registrationFeeCents: number;
  // Set only from a QR/deep-link URL (?date=YYYY-MM-DD) — the page has
  // already validated this date is genuinely eligible before rendering
  // the form at all (see app/open-play/register/page.tsx), so this is
  // just "which night to show as locked text," never re-validated here.
  // Someone who scanned Friday's poster must not be able to quietly pick
  // Saturday instead.
  lockedDate?: PublicOpenPlayNight;
  // Same settingsService.getGcashPaymentInfo()/getBusinessInfo() the
  // court booking flow already uses (app/book/page.tsx) — threaded down
  // to the awaiting-proof step below. Reported live: this screen never
  // received any of this, so it asked for a payment reference with no
  // way to know where the money should have gone.
  gcashInfo: GcashPaymentInfo;
  contactPhone: string;
  contactFacebookUrl: string;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [submittedAmount, setSubmittedAmount] = useState(String(registrationFeeCents / 100));

  const { control, register, handleSubmit } = useForm<PublicOpenPlayRegistrationFormValues>({
    defaultValues: {
      playerName: "",
      phone: "",
      skillLevel: "BEGINNER",
      date: lockedDate?.date ?? nights[0]?.date ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    if (!screenshot) {
      const message = "Please upload your payment screenshot to complete registration.";
      setServerError(message);
      toast.error(message);
      return;
    }
    const amountCents = Math.round(Number(submittedAmount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setServerError("Enter the amount you sent.");
      return;
    }

    startTransition(async () => {
      const result = await createPublicOpenPlayRegistrationAction(values);

      if (result.error && result.status !== "not-yet-open") {
        setServerError(result.error);
        return;
      }

      if (result.status === "not-yet-open" && result.opensAt) {
        setStep({
          kind: "not-yet-open",
          opensAt: new Date(result.opensAt).toLocaleDateString("en-PH", {
            month: "long",
            day: "numeric",
          }),
        });
        return;
      }
      if (result.status === "waitlisted") {
        setStep({ kind: "waitlisted" });
        return;
      }
      if (result.status === "registered" && result.registrationId) {
        // Owner request (2026-08-06, same fix already shipped for
        // bookings): a registration must not "push through" without a
        // real payment screenshot. This used to fall back to the
        // awaiting-proof retry step on any failure — with no guarantee
        // the customer ever came back, that left a real seat held
        // indefinitely with zero payment behind it (the exact live
        // incident reported here). A failed upload now cancels the hold
        // immediately via the SAME customer-cancellation path the
        // /open-play/cancel page uses (phone-verified, releases the seat
        // and promotes the waitlist same as any other cancellation) and
        // returns to the plain form — safe to retry because the seat is
        // actually free again, not a second seat on top of a dangling one.
        const registrationId = result.registrationId;
        let proofErrorMessage: string | null = null;
        try {
          const dataBase64 = await fileToBase64(screenshot);
          const proofResult = await submitPublicOpenPlayRegistrationPaymentProofAction({
            registrationId,
            gcashReference: null,
            submittedAmountCents: amountCents,
            screenshot: {
              fileName: screenshot.name,
              contentType: screenshot.type || "image/png",
              dataBase64,
            },
          });
          if (proofResult.error) {
            proofErrorMessage = proofResult.error;
          } else {
            setStep({ kind: "proof-submitted" });
          }
        } catch {
          proofErrorMessage = "We couldn't process your payment screenshot.";
        }

        if (proofErrorMessage !== null) {
          // Best-effort cleanup — the customer sees the real error
          // below regardless of whether this cancellation itself
          // succeeds; it exists to release the seat, not to change
          // what the customer is told.
          await cancelPublicOpenPlayRegistrationAction({ registrationId, phone: values.phone });
          toast.error(`${proofErrorMessage} This registration wasn't completed — please try again.`);
        }
        return;
      }
      setServerError(result.error ?? "Something went wrong. Please try again.");
    });
  });

  if (step.kind === "not-yet-open") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Not open yet</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Online registration for that date opens on {step.opensAt}. Please check back then, or
          visit the front desk.
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "waitlisted") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>You&apos;re on the waitlist</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          That night is full right now. We&apos;ll text you the moment a spot opens up — you&apos;ll
          have a time window to confirm and pay once invited.
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "awaiting-proof") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Slot held — send your GCash payment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-warning-foreground bg-warning/15 rounded-lg p-2 pt-2 text-xs">
            {step.proofFailedMessage ??
              "This slot is held for 30 minutes, not yet confirmed. Send your GCash payment, then submit the reference number and a screenshot below."}
          </p>
          <OpenPlayRegistrationProofForm
            registrationId={step.registrationId}
            expectedAmountCents={registrationFeeCents}
            gcashInfo={gcashInfo}
            contactPhone={contactPhone}
            contactFacebookUrl={contactFacebookUrl}
            onSubmitted={() => setStep({ kind: "proof-submitted" })}
          />
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "proof-submitted") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle className="text-success">Payment submitted</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          We received your payment and we&apos;re verifying it now — you&apos;ll get a text once
          it&apos;s confirmed.
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="playerName">Name</Label>
        <Input id="playerName" {...register("playerName", { required: true })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone number</Label>
        <Input id="phone" type="tel" {...register("phone", { required: true })} />
        <p className="text-muted-foreground text-xs">
          We&apos;ll text you here if a spot opens up or your payment is verified.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skillLevel">Skill level</Label>
        <Controller
          control={control}
          name="skillLevel"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="skillLevel" className="w-full">
                <SelectValue>{() => OPEN_PLAY_SKILL_LEVELS[field.value].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
                  <SelectItem key={level} value={level}>
                    {OPEN_PLAY_SKILL_LEVELS[level].label} —{" "}
                    {OPEN_PLAY_SKILL_LEVELS[level].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date">Night</Label>
        {lockedDate ? (
          <p
            id="date"
            className="border-input bg-muted/40 flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-sm font-medium"
          >
            <span>{lockedDate.label}</span>
            <span
              className={cn(
                "text-xs font-normal",
                lockedDate.remainingSeats <= 0 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {remainingSeatsLabel(lockedDate.remainingSeats)}
            </span>
          </p>
        ) : (
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="date" className="w-full">
                  <SelectValue placeholder="Select a night">
                    {(value: string) =>
                      nights.find((night) => night.date === value)?.label ?? "Select a night"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {nights.map((night) => (
                    <SelectItem key={night.date} value={night.date}>
                      <span className="flex w-full items-center justify-between gap-3">
                        <span>{night.label}</span>
                        <span className="text-muted-foreground text-xs">
                          {remainingSeatsLabel(night.remainingSeats)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Pay via GCash to complete your registration</p>
          <p className="text-muted-foreground text-xs">
            Send the registration fee to the account below, then attach your payment screenshot —
            your seat isn&apos;t held until both this form and the screenshot are submitted
            together.
          </p>
        </div>

        {gcashInfo.qrImageUrl ? (
          <Image
            src={gcashInfo.qrImageUrl}
            alt="GCash QR code"
            width={140}
            height={140}
            unoptimized
            className="self-center rounded-lg border"
          />
        ) : null}

        {gcashInfo.accountName || gcashInfo.accountNumber ? (
          <div className="rounded-lg border p-2 text-sm">
            {gcashInfo.accountName ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account name</span>
                <span className="font-medium">{gcashInfo.accountName}</span>
              </div>
            ) : null}
            {gcashInfo.accountNumber ? (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account number</span>
                <span className="font-mono font-medium">{gcashInfo.accountNumber}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="submittedAmount">Amount sent (₱)</Label>
          <Input
            id="submittedAmount"
            type="number"
            step="0.01"
            value={submittedAmount}
            onChange={(event) => setSubmittedAmount(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="screenshot">Payment screenshot (required)</Label>
          <div className="flex items-center gap-3">
            <label
              htmlFor="screenshot"
              className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}
            >
              Choose file
            </label>
            <span className="text-muted-foreground truncate text-sm">
              {screenshot ? screenshot.name : "No file chosen"}
            </span>
          </div>
          <input
            id="screenshot"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => setScreenshot(event.target.files?.[0] ?? null)}
          />
        </div>
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || (!lockedDate && nights.length === 0)}>
        {isPending ? "Submitting…" : "Register & submit payment"}
      </Button>
    </form>
  );
}
