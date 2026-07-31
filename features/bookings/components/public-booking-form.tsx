"use client";

import Image from "next/image";
import { useEffect, useState, useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  createPublicBookingAction,
  listPublicAvailableCoachesAction,
  listPublicCoachScheduleAction,
  listPublicCourtOccupiedWindowsAction,
  type PublicBookingCoachOption,
} from "@/actions/public-booking.actions";
import { submitPublicBookingPaymentProofAction } from "@/actions/public-booking-payment-proof.actions";
import { addPublicCoachToBookingAction } from "@/actions/public-coaching.actions";
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
import { PublicCoachAddOn, type PublicCoachAddOnConfirmed } from "@/features/coaching/components/public-coach-add-on";
import { ContactFallbackLinks } from "@/features/bookings/components/contact-fallback-links";
import { PublicPaymentProofUpload } from "@/features/bookings/components/public-payment-proof-upload";
import { useLiveNow } from "@/hooks/use-live-now";
import { getCourtBookingWindow, isHourInThePast } from "@/lib/court-hours";
import { cn, formatCurrency } from "@/lib/utils";
import { hasTimeOverlap } from "@/services/booking/booking-availability";
import type { CourtHoursSettings, GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

// Mirrors PublicPaymentProofUpload's own fileToBase64 — same established
// per-file duplicated pattern this codebase already uses (see that
// component's, and open-play's public registration form's, identical
// comment) rather than a shared cross-module helper.
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

// Presentation-only convenience list — no schema/service duration limit
// exists (services/booking/booking.service.ts's totalAmountCents is
// computed pro-rata from whatever startAt/endAt span is submitted).
// Hour-only: this business doesn't book in 30-minute increments, up to
// a reasonable 4-hour upper bound for a single-court booking.
const DURATIONS_MINUTES = [60, 120, 180, 240];

function formatDurationLabel(minutes: number): string {
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Hour-only start times — the native <input type="time"> showed three
// scrollable columns (hour/minute/AM-PM) and let a customer pick a
// minute this business doesn't support.
//
// Court/date-aware (found live: Court 1 closes 6 PM, but an earlier
// flat 7 AM-10 PM list let a customer pick 8 PM and then get a real
// server rejection — "OUTSIDE_OPERATING_HOURS" is genuinely enforced
// server-side in that case, so nothing ever double-books, but the
// dropdown itself was misleading). getCourtBookingWindow is the exact
// same pure function services/booking/booking.service.ts's server-side
// enforcement calls — same source of truth, not a second guess at it.
// The last valid START hour is closeMinutes MINUS the selected
// duration, so a longer booking correctly loses more trailing options
// than a 1-hour one would.
//
// Also filters out any hour whose start has already passed (found live:
// at 9:40 AM the dropdown still offered 7/8/9 AM today, even though the
// homepage grid already classified those as "Past"). isHourInThePast is
// the exact same function classifyCourtSlot uses for the grid — same
// source of truth, so the grid and this dropdown can't disagree about
// what counts as past. No separate "is this today" branch needed: a
// future date's slot starts are never <= now, so this naturally only
// ever removes options on today.
function getAvailableTimeOptions(
  courtHours: CourtHoursSettings,
  courtName: string | undefined,
  dateValue: string,
  durationMinutes: number,
  now: number,
): string[] {
  if (!courtName || !dateValue) {
    return [];
  }
  const date = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return [];
  }
  const window = getCourtBookingWindow(courtHours, courtName, date);
  const lastStartMinutes = window.closeMinutes - durationMinutes;

  const options: string[] = [];
  for (let minutes = window.openMinutes; minutes <= lastStartMinutes; minutes += 60) {
    const hours = Math.floor(minutes / 60);
    const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, 0);
    if (isHourInThePast(slotStart, now)) {
      continue;
    }
    options.push(`${String(hours).padStart(2, "0")}:00`);
  }
  return options;
}

function formatTimeLabel(value: string): string {
  const [hoursStr] = value.split(":");
  const hours = Number(hoursStr);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHour}:00 ${period}`;
}

interface PublicBookingFormCourt {
  id: string;
  name: string;
  hourlyRateCents: number | null;
}

interface PublicBookingFormValues {
  guestName: string;
  guestPhone: string;
  courtId: string;
  date: string;
  time: string;
  durationMinutes: string;
}

interface BookingConfirmation {
  bookingId: string;
  bookingReference: string;
  courtName: string;
  date: string;
  time: string;
  durationMinutes: number;
  guestName: string;
  guestPhone: string;
  // Already computed and persisted server-side (pro-rata) — see
  // services/booking/booking.service.ts's totalAmountCents.
  totalAmountCents: number;
  // Phase 8: true only when the owner-controlled GCash-prepayment switch
  // is on. Must not be silently ignored here — showing "Booking
  // confirmed... payment collected at the venue" for what's actually a
  // 4-hour hold waiting on GCash proof would tell a customer their
  // slot is secured when it isn't yet.
  requiresPayment: boolean;
  // Independent of requiresPayment above — offered whether this booking
  // landed CONFIRMED or as a hold, since attaching a coach never depends
  // on the court booking's payment state (see public-booking.actions.ts's
  // comment on this same field).
  availableCoaches: PublicBookingCoachOption[];
  // Only set when requiresPayment is true. Reported live: customers were
  // reading this screen as "I'm already booked" and not paying — the fix
  // is showing an exact clock time ("Held until 8:42 PM"), not a vague
  // duration, right next to an imperative "Pay to confirm" lead line.
  holdExpiresAt?: Date;
}

const holdTimeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface PublicBookingFormProps {
  courts: PublicBookingFormCourt[];
  courtHours: CourtHoursSettings;
  gcashInfo: GcashPaymentInfo;
  contactPhone: string;
  contactFacebookUrl: string;
  initialCourtId?: string;
  initialDate?: string;
  initialTime?: string;
  initialDurationMinutes?: string;
  // Phase 8's owner-controlled GCash-prepayment switch (settingsService.
  // getBookingRequirePrepayment). When true, the payment screenshot is
  // now required in this same initial form — see onSubmit below — same
  // "no dead AWAITING_PAYMENT holds" fix already shipped for open-play
  // registration. When false, this is a pay-at-venue booking and no
  // screenshot is ever asked for, unchanged from before.
  requiresPrepayment: boolean;
}

export function PublicBookingForm({
  courts,
  courtHours,
  gcashInfo,
  contactPhone,
  contactFacebookUrl,
  initialCourtId,
  initialDate,
  initialTime,
  initialDurationMinutes,
  requiresPrepayment,
}: PublicBookingFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [confirmation, setConfirmation] = useState<BookingConfirmation | null>(null);
  // Lifted out of PublicCoachAddOn so the payment amount/instructions can
  // recompute live when a coach is added or removed — see
  // coach-session.service.ts's ordering-guard comment for why this can
  // only ever change before hasSubmittedProof flips true.
  const [coachSession, setCoachSession] = useState<PublicCoachAddOnConfirmed | null>(null);
  const [hasSubmittedProof, setHasSubmittedProof] = useState(false);
  const [occupiedWindows, setOccupiedWindows] = useState<{ startAt: Date; endAt: Date }[]>([]);
  const [isLoadingAvailability, setIsLoadingAvailability] = useState(false);
  // Reported live: coaching was only offered AFTER a booking was
  // created, on a separate screen — customers clicked "Book Now" and
  // walked away without ever seeing it. Collected here instead, in the
  // same form/click, so the Total below is coach-inclusive before
  // anyone submits. previewCoachId/previewGroupSize are plain form
  // state, not react-hook-form fields — there's no bookingId yet for
  // them to attach to; that only happens inside onSubmit, right after
  // the booking itself is created (see addPublicCoachToBookingAction
  // call below).
  const [previewCoaches, setPreviewCoaches] = useState<PublicBookingCoachOption[]>([]);
  const [isLoadingCoaches, setIsLoadingCoaches] = useState(false);
  const [previewCoachId, setPreviewCoachId] = useState("");
  const [previewGroupSize, setPreviewGroupSize] = useState("");
  // "See availability" — lazy per-coach fetch (only when actually
  // clicked, not for every coach on every render), cached by coachId so
  // re-opening the same coach's schedule after closing it doesn't
  // re-fetch. openScheduleCoachId is which panel (if any) is expanded.
  const [openScheduleCoachId, setOpenScheduleCoachId] = useState<string | null>(null);
  const [coachSchedules, setCoachSchedules] = useState<Record<string, { startAt: Date; endAt: Date }[]>>({});
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  // Reported live: customers clicked "Book Now" and walked away without
  // ever sending GCash payment or uploading proof — dead AWAITING_PAYMENT
  // holds tying up slots until their hold expired on its own. Same fix
  // already shipped for open-play registration: the screenshot is
  // required in the SAME click as booking, not a separate step someone
  // can abandon. Only relevant when requiresPrepayment is true.
  const [bookingScreenshot, setBookingScreenshot] = useState<File | null>(null);
  const [bookingSubmittedAmount, setBookingSubmittedAmount] = useState("");
  const [hasEditedBookingAmount, setHasEditedBookingAmount] = useState(false);
  const [autoSubmittedProofFileName, setAutoSubmittedProofFileName] = useState<string | null>(null);

  const validInitialDuration =
    initialDurationMinutes && DURATIONS_MINUTES.includes(Number(initialDurationMinutes))
      ? initialDurationMinutes
      : undefined;
  const initialCourtIdResolved = initialCourtId ?? courts[0]?.id ?? "";
  const initialDateResolved = initialDate ?? toLocalDateValue(new Date());
  const initialDurationResolved = validInitialDuration ?? "60";
  const initialCourtName = courts.find((court) => court.id === initialCourtIdResolved)?.name;
  const initialTimeOptions = getAvailableTimeOptions(
    courtHours,
    initialCourtName,
    initialDateResolved,
    Number(initialDurationResolved),
    Date.now(),
  );
  const validInitialTime = initialTime && initialTimeOptions.includes(initialTime) ? initialTime : undefined;

  const { control, register, handleSubmit, setValue } = useForm<PublicBookingFormValues>({
    defaultValues: {
      guestName: "",
      guestPhone: "",
      courtId: initialCourtIdResolved,
      date: initialDateResolved,
      time: validInitialTime ?? initialTimeOptions[0] ?? "",
      durationMinutes: initialDurationResolved,
    },
  });

  // Preview-only — mirrors booking.service.ts's own Math.round(hourlyRateCents
  // * durationHours) so the number shown here matches what the server will
  // actually charge, same shape as the staff booking form's own "Pricing
  // summary" preview. Never fed back into the submitted payload; the
  // server still computes and persists the real amount independently.
  const watchedCourtId = useWatch({ control, name: "courtId" });
  const watchedDate = useWatch({ control, name: "date" });
  const watchedTime = useWatch({ control, name: "time" });
  const watchedDurationMinutes = useWatch({ control, name: "durationMinutes" });
  const selectedCourt = courts.find((court) => court.id === watchedCourtId);
  const previewDurationHours = Number(watchedDurationMinutes) / 60;
  const previewCourtTotalCents =
    selectedCourt?.hourlyRateCents != null && Number.isFinite(previewDurationHours)
      ? Math.round(selectedCourt.hourlyRateCents * previewDurationHours)
      : null;

  // useLiveNow, not an inline Date.now() — a public visitor typically
  // loads this page fresh, but nothing here re-renders on its own as
  // wall-clock time passes, so a tab left open past an hour boundary
  // would otherwise keep offering an already-elapsed start time
  // indefinitely (see hooks/use-live-now.ts).
  const now = useLiveNow();

  // Recomputed on every court/date/duration change — the same source of
  // truth server-side enforcement uses (see getAvailableTimeOptions's own
  // comment above). Business-hours-only, not yet checked against real
  // bookings — see availableTimeOptions below for the conflict-filtered
  // list actually rendered.
  const businessHoursTimeOptions = getAvailableTimeOptions(
    courtHours,
    selectedCourt?.name,
    watchedDate,
    Number(watchedDurationMinutes),
    now,
  );

  // Reported live: the dropdown still offered a slot a real CONFIRMED
  // booking already held — a customer only found out at submit, via the
  // server's own conflict check (unchanged; still the real gate, and
  // already proven to reject before a hold or GCash screen ever exists —
  // see createBookingHold/createBooking's own Serializable-transaction
  // availability check). This is a UX preview layered on top, same
  // pattern and same listPublicCourtOccupiedWindowsAction/
  // listOccupiedWindows source as the staff booking form's identical fix.
  // One fetch per court/date; duration changes recompute the per-slot
  // overlap check locally rather than re-fetching.
  useEffect(() => {
    if (!selectedCourt || !watchedDate) {
      setOccupiedWindows([]);
      setIsLoadingAvailability(false);
      return;
    }
    const dayStart = new Date(`${watchedDate}T00:00:00`);
    if (Number.isNaN(dayStart.getTime())) {
      setOccupiedWindows([]);
      return;
    }
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    let cancelled = false;
    setIsLoadingAvailability(true);
    listPublicCourtOccupiedWindowsAction(selectedCourt.id, dayStart, dayEnd).then((result) => {
      if (cancelled) {
        return;
      }
      setIsLoadingAvailability(false);
      setOccupiedWindows(result.windows.map((window) => ({ startAt: new Date(window.startAt), endAt: new Date(window.endAt) })));
    });
    return () => {
      cancelled = true;
    };
    // selectedCourt?.id, not the object itself — a new courts.find(...)
    // result every render would otherwise re-fire this on every keystroke
    // elsewhere in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourt?.id, watchedDate]);

  function candidateSlot(time: string): { startAt: Date; endAt: Date } | null {
    if (!watchedDate) {
      return null;
    }
    const [year, month, day] = watchedDate.split("-").map(Number);
    const [hours] = time.split(":").map(Number);
    const startAt = new Date(year, month - 1, day, hours, 0);
    if (Number.isNaN(startAt.getTime())) {
      return null;
    }
    return { startAt, endAt: new Date(startAt.getTime() + Number(watchedDurationMinutes) * 60 * 1000) };
  }

  const availableTimeOptions = businessHoursTimeOptions.filter((time) => {
    const slot = candidateSlot(time);
    if (!slot) {
      return false;
    }
    return !occupiedWindows.some((window) => hasTimeOverlap(slot.startAt, slot.endAt, window.startAt, window.endAt));
  });

  useEffect(() => {
    if (availableTimeOptions.length > 0 && !availableTimeOptions.includes(watchedTime)) {
      setValue("time", availableTimeOptions[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTimeOptions.join(","), watchedTime]);

  // Live coach availability for the currently-selected slot — same
  // "candidate slot" the time-conflict check above already computes, one
  // fetch whenever the slot actually changes. Resets the picked coach
  // whenever the slot moves out from under it (a coach available at 5 PM
  // isn't necessarily available at 8 PM), same reasoning as the time
  // dropdown resetting itself above.
  useEffect(() => {
    const slot = candidateSlot(watchedTime);
    if (!slot) {
      setPreviewCoaches([]);
      setIsLoadingCoaches(false);
      return;
    }
    let cancelled = false;
    setIsLoadingCoaches(true);
    listPublicAvailableCoachesAction(slot.startAt, slot.endAt).then((result) => {
      if (cancelled) {
        return;
      }
      setIsLoadingCoaches(false);
      setPreviewCoaches(result.coaches);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourt?.id, watchedDate, watchedTime, watchedDurationMinutes]);

  useEffect(() => {
    if (previewCoachId && !previewCoaches.some((coach) => coach.id === previewCoachId)) {
      setPreviewCoachId("");
      setPreviewGroupSize("");
    }
    setOpenScheduleCoachId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewCoaches]);

  async function toggleCoachSchedule(coachId: string) {
    if (openScheduleCoachId === coachId) {
      setOpenScheduleCoachId(null);
      return;
    }
    setOpenScheduleCoachId(coachId);
    if (coachSchedules[coachId]) {
      return;
    }
    setIsLoadingSchedule(true);
    const result = await listPublicCoachScheduleAction(coachId);
    setIsLoadingSchedule(false);
    setCoachSchedules((prev) => ({
      ...prev,
      [coachId]: result.windows.map((window) => ({ startAt: new Date(window.startAt), endAt: new Date(window.endAt) })),
    }));
  }

  const selectedPreviewCoach = previewCoaches.find((coach) => coach.id === previewCoachId);
  const previewCoachGroupSizeOptions = selectedPreviewCoach
    ? selectedPreviewCoach.rates.map((rate) => rate.groupSize).sort((a, b) => a - b)
    : [];
  const selectedPreviewRate = selectedPreviewCoach?.rates.find((rate) => rate.groupSize === Number(previewGroupSize));
  const previewCoachFeeCents = selectedPreviewRate?.priceCents ?? 0;
  const previewTotalCents = previewCourtTotalCents != null ? previewCourtTotalCents + previewCoachFeeCents : null;

  // Pre-fills the "amount sent" field with the live total, same resync-
  // until-hand-edited guard PublicPaymentProofUpload already uses for
  // this exact reason (adding a coach, or changing court/date/time,
  // recomputes the total after the customer may have already started
  // typing).
  useEffect(() => {
    if (!hasEditedBookingAmount && previewTotalCents != null) {
      setBookingSubmittedAmount(String(previewTotalCents / 100));
    }
  }, [previewTotalCents, hasEditedBookingAmount]);

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    if (requiresPrepayment && !bookingScreenshot) {
      const message = "Please upload your proof of payment to complete your booking.";
      setServerError(message);
      toast.error(message);
      return;
    }
    const bookingAmountCents = requiresPrepayment ? Math.round(Number(bookingSubmittedAmount) * 100) : 0;
    if (requiresPrepayment && (!Number.isFinite(bookingAmountCents) || bookingAmountCents <= 0)) {
      setServerError("Enter the amount you sent.");
      return;
    }

    startTransition(async () => {
      const result = await createPublicBookingAction({
        guestName: values.guestName,
        guestPhone: values.guestPhone,
        courtId: values.courtId,
        date: values.date,
        time: values.time,
        durationMinutes: Number(values.durationMinutes),
      });

      if (result.error || !result.bookingReference) {
        setServerError(result.error ?? "Something went wrong. Please try again.");
        return;
      }

      const bookingId = result.bookingId ?? "";

      // The coach picked in the form above is only local state until now
      // — attach it right after the booking itself exists, same action
      // PublicCoachAddOn's own "Add coach" button calls, just fired
      // automatically instead of waiting for a second click. Re-checked
      // against result.availableCoaches (the just-fetched, authoritative
      // list) rather than trusting the preview picker blindly — coach
      // availability could have changed in the moments between preview
      // and submit.
      if (
        previewCoachId &&
        previewGroupSize &&
        (result.availableCoaches ?? []).some((coach) => coach.id === previewCoachId)
      ) {
        const addResult = await addPublicCoachToBookingAction({
          bookingId,
          coachId: previewCoachId,
          groupSize: Number(previewGroupSize),
        });
        if (addResult.error) {
          toast.error(`Your slot is booked, but we couldn't add the coach automatically: ${addResult.error} Add them below.`);
        } else {
          setCoachSession({
            coachName: previewCoaches.find((coach) => coach.id === previewCoachId)?.name ?? "Coach",
            priceCents: addResult.priceCents ?? previewCoachFeeCents,
          });
        }
      } else if (previewCoachId && previewGroupSize) {
        toast.error("Your slot is booked, but the coach you picked is no longer available for this time. Add one below if you'd like.");
      }

      // Same one-click chaining as the coach add-on above: the
      // screenshot picked in the form is only local state until the
      // booking exists. Submitted right after, using the amount the
      // customer confirmed above — not recomputed here, since that's
      // exactly what they said they sent.
      if (requiresPrepayment && result.requiresPayment && bookingScreenshot) {
        try {
          const dataBase64 = await fileToBase64(bookingScreenshot);
          const proofResult = await submitPublicBookingPaymentProofAction({
            bookingId,
            gcashReference: null,
            submittedAmountCents: bookingAmountCents,
            screenshot: {
              fileName: bookingScreenshot.name,
              contentType: bookingScreenshot.type || "image/png",
              dataBase64,
            },
          });
          if (proofResult.error) {
            toast.error(`Your slot is booked, but the screenshot upload failed: ${proofResult.error} Please try again below.`);
          } else {
            setAutoSubmittedProofFileName(bookingScreenshot.name);
            setHasSubmittedProof(true);
          }
        } catch {
          toast.error("Your slot is booked, but the screenshot upload failed. Please try again below.");
        }
      }

      setConfirmation({
        bookingId,
        bookingReference: result.bookingReference,
        courtName: courts.find((court) => court.id === values.courtId)?.name ?? "",
        date: values.date,
        time: values.time,
        durationMinutes: Number(values.durationMinutes),
        guestName: values.guestName,
        guestPhone: values.guestPhone,
        totalAmountCents: result.totalAmountCents ?? 0,
        requiresPayment: result.requiresPayment ?? false,
        availableCoaches: result.availableCoaches ?? [],
        holdExpiresAt: result.holdExpiresAt,
      });
    });
  });

  if (confirmation) {
    const coachFeeCents = coachSession?.priceCents ?? 0;
    const totalDueCents = confirmation.totalAmountCents + coachFeeCents;

    // Genuinely confirmed (pay-at-venue-by-default, requiresPayment
    // false) is a real completion — Card + success styling stays.
    if (!confirmation.requiresPayment) {
      return (
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle className="text-success">Booking confirmed</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Reference</span>
              <span className="font-mono font-medium">{confirmation.bookingReference}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{confirmation.guestName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Court</span>
              <span className="font-medium">{confirmation.courtName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span className="font-medium">{confirmation.date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Time</span>
              <span className="font-medium">{confirmation.time}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Duration</span>
              <span className="font-medium">{formatDurationLabel(confirmation.durationMinutes)}</span>
            </div>
            {coachSession ? (
              <>
                <div className="flex justify-between border-t pt-3">
                  <span className="text-muted-foreground">Court hire</span>
                  <span className="font-medium tabular-nums">{formatCurrency(confirmation.totalAmountCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Coaching ({coachSession.coachName})</span>
                  <span className="font-medium tabular-nums">{formatCurrency(coachSession.priceCents)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-base">
                  <span className="font-medium">Total</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(totalDueCents)}</span>
                </div>
              </>
            ) : (
              <div className="flex justify-between border-t pt-3 text-base">
                <span className="font-medium">Total</span>
                <span className="font-semibold tabular-nums">{formatCurrency(totalDueCents)}</span>
              </div>
            )}
            <p className="text-muted-foreground pt-2 text-xs">
              Save your reference and phone number — you can look up this booking anytime from the
              Booking Lookup page. Payment is collected at the venue.
            </p>
            <div className="border-t pt-3">
              <PublicCoachAddOn
                bookingId={confirmation.bookingId}
                availableCoaches={confirmation.availableCoaches}
                requiresPayment={confirmation.requiresPayment}
                hasSubmittedProof={hasSubmittedProof}
                contactPhone={contactPhone}
                contactFacebookUrl={contactFacebookUrl}
                initialConfirmed={coachSession}
                onCoachSessionChange={setCoachSession}
              />
            </div>
          </CardContent>
        </Card>
      );
    }

    // requiresPayment true — deliberately NOT a Card. Reported live:
    // a boxed panel replacing the form read as a receipt/arrival, and
    // people stopped there without paying. Same bare container shape
    // as the form itself (mx-auto max-w-md flex flex-col gap-4,
    // matching the <form> below) so this reads as the form
    // continuing, not a new screen — no border, no shadow, no
    // success color, no checkmark anywhere in this branch. The hold
    // itself is unchanged: the booking (and its hold) already exists
    // by this point, same as before — only the FEEL of this state
    // changed, not the sequence (create hold, then pay).
    return (
      <div className="mx-auto flex max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Pay {formatCurrency(totalDueCents)} to confirm your slot</h2>
          {/* text-warning, not text-warning-foreground — that token is
              designed for dark text ON a light bg-warning box (see
              public-payment-proof-upload.tsx's own such box). This line
              sits directly on the page background now that the Card
              wrapper is gone, so the "on-warning" foreground color was
              nearly invisible here — same class of contrast bug as the
              table header fix earlier this session, caught the same way
              (looked at the actual rendered screenshot). */}
          <p className="text-warning text-sm font-medium">
            Your slot isn&apos;t reserved until we receive your payment.
            {confirmation.holdExpiresAt
              ? ` Held until ${holdTimeFormatter.format(confirmation.holdExpiresAt)}.`
              : ""}
          </p>
        </div>

        <div className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Reference:</span> {confirmation.bookingReference}
          </p>
          <p>
            <span className="text-muted-foreground">Name:</span> {confirmation.guestName}
          </p>
          <p>
            <span className="text-muted-foreground">Court:</span> {confirmation.courtName}
          </p>
          <p>
            <span className="text-muted-foreground">Date:</span> {confirmation.date}
          </p>
          <p>
            <span className="text-muted-foreground">Time:</span> {confirmation.time}
          </p>
          <p>
            <span className="text-muted-foreground">Duration:</span> {formatDurationLabel(confirmation.durationMinutes)}
          </p>
          {coachSession ? (
            <>
              <p>
                <span className="text-muted-foreground">Court hire:</span>{" "}
                <span>{formatCurrency(confirmation.totalAmountCents)}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Coaching ({coachSession.coachName}):</span>{" "}
                <span>{formatCurrency(coachSession.priceCents)}</span>
              </p>
            </>
          ) : null}
          <p className="font-medium">
            Total: <span>{formatCurrency(totalDueCents)}</span>
          </p>
        </div>

        <p className="text-muted-foreground text-xs">Save your reference and phone number to look this up later.</p>

        <PublicPaymentProofUpload
          bookingId={confirmation.bookingId}
          bookingReference={confirmation.bookingReference}
          amountDueCents={totalDueCents}
          guestPhone={confirmation.guestPhone}
          gcashInfo={gcashInfo}
          initialSubmittedFileName={autoSubmittedProofFileName}
          onSubmitted={() => setHasSubmittedProof(true)}
        />
        {contactPhone || contactFacebookUrl ? (
          <p className="text-muted-foreground text-xs">
            Wrong file, or haven&apos;t heard back?{" "}
            <ContactFallbackLinks phone={contactPhone} facebookUrl={contactFacebookUrl} />.
          </p>
        ) : null}

        {/* Offered regardless of requiresPayment above — a held slot
            can still have a coach attached before payment clears, same
            as coach-session.service.ts's createCoachSession itself
            never gating on Booking.status. Locked once hasSubmittedProof
            flips true — see that same service's ordering-guard comment. */}
        <div className="border-t pt-3">
          <PublicCoachAddOn
            bookingId={confirmation.bookingId}
            availableCoaches={confirmation.availableCoaches}
            requiresPayment={confirmation.requiresPayment}
            hasSubmittedProof={hasSubmittedProof}
            contactPhone={contactPhone}
            contactFacebookUrl={contactFacebookUrl}
            initialConfirmed={coachSession}
            onCoachSessionChange={setCoachSession}
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestName">Name</Label>
        <Input id="guestName" {...register("guestName", { required: true })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestPhone">Phone number</Label>
        <Input id="guestPhone" type="tel" {...register("guestPhone", { required: true })} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="courtId">Court</Label>
        <Controller
          control={control}
          name="courtId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="courtId" className="w-full">
                <SelectValue placeholder="Select a court">
                  {(value: string) => courts.find((court) => court.id === value)?.name ?? "Select a court"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {courts.map((court) => (
                  <SelectItem key={court.id} value={court.id}>
                    {court.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date">Date</Label>
          <Input id="date" type="date" {...register("date", { required: true })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="time">Time</Label>
          <Controller
            control={control}
            name="time"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isLoadingAvailability || availableTimeOptions.length === 0}
              >
                <SelectTrigger id="time" className="w-full">
                  <SelectValue placeholder={isLoadingAvailability ? "Checking availability…" : "No times available"}>
                    {(value: string) => (value ? formatTimeLabel(value) : "No times available")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {availableTimeOptions.map((time) => (
                    <SelectItem key={time} value={time}>
                      {formatTimeLabel(time)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {!isLoadingAvailability && availableTimeOptions.length === 0 && selectedCourt ? (
            <p className="text-muted-foreground text-xs">
              {watchedDate === toLocalDateValue(new Date())
                ? "No times left today — try tomorrow or another court."
                : `${selectedCourt.name} has no ${formatDurationLabel(Number(watchedDurationMinutes)).toLowerCase()} slot available that day — try a shorter duration or another court.`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="durationMinutes">Duration</Label>
        <Controller
          control={control}
          name="durationMinutes"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="durationMinutes" className="w-full">
                <SelectValue>{(value: string) => formatDurationLabel(Number(value))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DURATIONS_MINUTES.map((minutes) => (
                  <SelectItem key={minutes} value={String(minutes)}>
                    {formatDurationLabel(minutes)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Coach (optional)</Label>
        {isLoadingCoaches ? (
          <p className="text-muted-foreground text-xs">Checking coach availability…</p>
        ) : previewCoaches.length === 0 ? (
          <p className="text-muted-foreground text-xs">No coach available at this slot.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Reported live: a dropdown to click open just to see who's
                available was an extra, pointless step — clickable cards
                instead, whether there's one coach or several. Clicking
                the already-selected card again deselects it. */}
            <div className="flex flex-wrap gap-2">
              {previewCoaches.map((coach) => {
                const isSelected = previewCoachId === coach.id;
                return (
                  <button
                    key={coach.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setPreviewCoachId("");
                        setPreviewGroupSize("");
                      } else {
                        setPreviewCoachId(coach.id);
                        setPreviewGroupSize("");
                      }
                    }}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                      isSelected ? "border-success bg-success/10 text-success" : "border-input hover:bg-muted/40",
                    )}
                  >
                    {coach.name}
                  </button>
                );
              })}
            </div>

            {previewCoaches.map((coach) => (
              <div key={coach.id} className="flex flex-col gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-foreground w-fit px-0"
                  onClick={() => toggleCoachSchedule(coach.id)}
                >
                  {openScheduleCoachId === coach.id ? "Hide" : "See"} {coach.name}&apos;s availability
                </Button>
                {openScheduleCoachId === coach.id ? (
                  <div className="bg-muted/40 flex flex-col gap-1 rounded-lg border p-2 text-xs">
                    {isLoadingSchedule && !coachSchedules[coach.id] ? (
                      <span className="text-muted-foreground">Loading schedule…</span>
                    ) : (coachSchedules[coach.id]?.length ?? 0) === 0 ? (
                      <span className="text-muted-foreground">No upcoming open times found.</span>
                    ) : (
                      coachSchedules[coach.id]!.map((window, index) => (
                        <span key={index}>
                          {window.startAt.toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })},{" "}
                          {window.startAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}–
                          {window.endAt.toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            ))}

            {previewCoachId ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="previewGroupSize">Group size (select to add {selectedPreviewCoach?.name ?? "a coach"})</Label>
                <Select value={previewGroupSize} onValueChange={(value) => setPreviewGroupSize(value ?? "")}>
                  <SelectTrigger id="previewGroupSize" className="w-full">
                    <SelectValue placeholder="Select group size">
                      {(value: string) => (value ? `${value} ${Number(value) === 1 ? "person" : "people"}` : "Select group size")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {previewCoachGroupSizeOptions.map((size) => (
                      <SelectItem key={size} value={String(size)}>
                        {size} {size === 1 ? "person" : "people"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedPreviewRate ? (
                  <p className="text-sm">
                    <span className="text-muted-foreground">Coach rate: </span>
                    <span className="font-medium">{formatCurrency(selectedPreviewRate.priceCents)}</span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Court rate</span>
            <span className="font-medium tabular-nums">
              {selectedCourt?.hourlyRateCents != null
                ? `${formatCurrency(selectedCourt.hourlyRateCents)}/hr`
                : "—"}
            </span>
          </div>
          {previewCoachFeeCents > 0 ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Coach rate</span>
              <span className="font-medium tabular-nums">{formatCurrency(previewCoachFeeCents)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t pt-2 text-base">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">
              {previewTotalCents != null ? formatCurrency(previewTotalCents) : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {requiresPrepayment ? (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Pay via GCash to confirm your slot</p>
            <p className="text-muted-foreground text-xs">
              Send the total above to the account below, then attach your payment screenshot — your slot
              isn&apos;t held until both this form and the screenshot are submitted together.
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
            <Label htmlFor="bookingSubmittedAmount">Amount sent (₱)</Label>
            <Input
              id="bookingSubmittedAmount"
              type="number"
              step="0.01"
              value={bookingSubmittedAmount}
              onChange={(event) => {
                setHasEditedBookingAmount(true);
                setBookingSubmittedAmount(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bookingScreenshot">Payment screenshot (required)</Label>
            <div className="flex items-center gap-3">
              <label
                htmlFor="bookingScreenshot"
                className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "cursor-pointer")}
              >
                Choose file
              </label>
              <span className="text-muted-foreground truncate text-sm">
                {bookingScreenshot ? bookingScreenshot.name : "No file chosen"}
              </span>
            </div>
            <input
              id="bookingScreenshot"
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => setBookingScreenshot(event.target.files?.[0] ?? null)}
            />
          </div>
        </div>
      ) : null}

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button
        type="submit"
        size="lg"
        disabled={isPending || courts.length === 0 || isLoadingAvailability || availableTimeOptions.length === 0}
      >
        {isPending ? "Booking…" : "Book Now"}
      </Button>
    </form>
  );
}
