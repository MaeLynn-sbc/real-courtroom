"use client";

import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";

import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OpenPlayRegistrationProofForm } from "@/features/open-play-capacity/components/open-play-registration-proof-form";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

export interface PublicOpenPlayNight {
  date: string; // "YYYY-MM-DD"
  label: string; // "Fri, Aug 1"
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
type Step =
  | { kind: "form" }
  | { kind: "waitlisted" }
  | { kind: "not-yet-open"; opensAt: string }
  | { kind: "awaiting-proof"; registrationId: string; playerName: string }
  | { kind: "proof-submitted" };

export function PublicOpenPlayRegistrationForm({
  nights,
  registrationFeeCents,
  lockedDate,
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

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      const result = await createPublicOpenPlayRegistrationAction(values);

      if (result.error && result.status !== "not-yet-open") {
        setServerError(result.error);
        return;
      }

      if (result.status === "not-yet-open" && result.opensAt) {
        setStep({ kind: "not-yet-open", opensAt: new Date(result.opensAt).toLocaleDateString("en-PH", { month: "long", day: "numeric" }) });
        return;
      }
      if (result.status === "waitlisted") {
        setStep({ kind: "waitlisted" });
        return;
      }
      if (result.status === "registered" && result.registrationId) {
        setStep({ kind: "awaiting-proof", registrationId: result.registrationId, playerName: values.playerName });
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
          Online registration for that date opens on {step.opensAt}. Please check back then, or visit the
          front desk.
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
          That night is full right now. We&apos;ll text you the moment a spot opens up — you&apos;ll have a
          time window to confirm and pay once invited.
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
            This slot is held for 30 minutes, not yet confirmed. Send your GCash payment, then submit the
            reference number and a screenshot below.
          </p>
          <OpenPlayRegistrationProofForm
            registrationId={step.registrationId}
            expectedAmountCents={registrationFeeCents}
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
          We received your payment and we&apos;re verifying it now — you&apos;ll get a text once it&apos;s
          confirmed.
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
        <p className="text-muted-foreground text-xs">We&apos;ll text you here if a spot opens up or your payment is verified.</p>
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
                    {OPEN_PLAY_SKILL_LEVELS[level].label} — {OPEN_PLAY_SKILL_LEVELS[level].description}
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
          <p id="date" className="border-input bg-muted/40 rounded-lg border px-2.5 py-2 text-sm font-medium">
            {lockedDate.label}
          </p>
        ) : (
          <Controller
            control={control}
            name="date"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="date" className="w-full">
                  <SelectValue placeholder="Select a night">
                    {(value: string) => nights.find((night) => night.date === value)?.label ?? "Select a night"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {nights.map((night) => (
                    <SelectItem key={night.date} value={night.date}>
                      {night.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        )}
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={isPending || (!lockedDate && nights.length === 0)}>
        {isPending ? "Registering…" : "Register"}
      </Button>
    </form>
  );
}
