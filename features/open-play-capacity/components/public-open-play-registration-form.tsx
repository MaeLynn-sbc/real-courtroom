"use client";

import { useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";

import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import { Button } from "@/components/ui/button";
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
      holdExpiresAt?: string;
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
  waitlistedMessage,
  waitlistEnabled = false,
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
  // Owner-editable (features/open-play-capacity/components/open-play-
  // settings-panel.tsx) — see its own comment for why this replaced a
  // hardcoded "we'll text you" promise.
  waitlistedMessage: string;
  // Off (owner, 2026-10-16): a full night has no waitlist — the button is
  // disabled so nobody can push a registration through.
  waitlistEnabled?: boolean;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>({ kind: "form" });

  const { control, register, handleSubmit } = useForm<PublicOpenPlayRegistrationFormValues>({
    defaultValues: {
      playerName: "",
      phone: "",
      skillLevel: "BEGINNER",
      date: lockedDate?.date ?? nights[0]?.date ?? "",
    },
  });

  // Reported live (2026-08-07): the GCash QR/payment section used to
  // render unconditionally regardless of the SELECTED date's capacity —
  // a customer picking an already-full night still saw "send payment
  // now." lockedDate is fixed for the whole page lifetime (the QR-deep-
  // link path), but the plain picker's date can change at any time, so
  // this has to be a live watch, not a value read once at mount —
  // that's the specific regression the failing-first test below guards.
  const watchedDate = useWatch({ control, name: "date" });
  const selectedNight = lockedDate ?? nights.find((night) => night.date === watchedDate);
  const isFull = selectedNight ? selectedNight.remainingSeats <= 0 : false;

  // Reserve FIRST, pay second (owner, 2026-10-16: "don't show the payment
  // option for the waitlist"). Customers used to see the GCash details on
  // this form and pay BEFORE submitting; if the night filled meanwhile
  // they landed on the waitlist with their money unrecorded (7 people on
  // Oct 16). Now this form only reserves: the server holds a seat (30
  // minutes) or puts them on the waitlist, and only a held seat ever sees
  // the payment step. An unpaid hold frees itself when it expires.
  const onSubmit = handleSubmit((values) => {
    setServerError(null);

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
        setStep({
          kind: "awaiting-proof",
          registrationId: result.registrationId,
          playerName: values.playerName,
          holdExpiresAt: result.holdExpiresAt
            ? new Date(result.holdExpiresAt).toISOString()
            : undefined,
        });
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
          That night is full right now. {waitlistedMessage}
        </CardContent>
      </Card>
    );
  }

  if (step.kind === "awaiting-proof") {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>Step 2 of 2 — pay to confirm your seat</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-warning-foreground bg-warning/15 rounded-lg p-3 text-sm">
            {step.proofFailedMessage ?? (
              <>
                <strong>A seat is held for {step.playerName}</strong>
                {step.holdExpiresAt
                  ? ` until ${new Date(step.holdExpiresAt).toLocaleTimeString("en-PH", {
                      hour: "numeric",
                      minute: "2-digit",
                    })}`
                  : " for 30 minutes"}
                . You&apos;re <strong>not registered yet</strong> — send your GCash payment and
                upload the screenshot below, or the seat goes to the next person.
              </>
            )}
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
                lockedDate.remainingSeats <= 0
                  ? "text-destructive text-sm font-bold"
                  : "text-muted-foreground text-xs font-normal",
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
                        <span
                          className={
                            night.remainingSeats <= 0
                              ? "text-destructive text-sm font-bold"
                              : "text-muted-foreground text-xs"
                          }
                        >
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

      {isFull ? (
        <div className="border-warning/40 bg-warning/10 flex flex-col gap-1 rounded-lg border p-3 text-sm">
          <p className="font-medium">This night is full.</p>
          <p className="text-muted-foreground">
            {waitlistEnabled ? (
              <>Join the waitlist below — don&apos;t send any payment. {waitlistedMessage}</>
            ) : (
              <>
                There are no more online slots for this night — please don&apos;t send any payment.
              </>
            )}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">
          Step 1 of 2: reserve your seat. If one is free, we&apos;ll hold it for you and show how to
          pay. If the night is full, you&apos;ll join the waitlist instead — no payment needed.
        </p>
      )}

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={isPending || (!lockedDate && nights.length === 0) || (isFull && !waitlistEnabled)}
      >
        {isFull && !waitlistEnabled
          ? "Night is full"
          : isFull
            ? isPending
              ? "Joining waitlist…"
              : "Join waitlist"
            : isPending
              ? "Reserving…"
              : "Reserve my seat"}
      </Button>
    </form>
  );
}
