import { z } from "zod";

export const createAvailabilityWindowSchema = z
  .object({
    coachId: z.string().min(1),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    notes: z.string().max(500).optional(),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  });
export type CreateAvailabilityWindowInput = z.infer<typeof createAvailabilityWindowSchema>;

// The week-grid UI's write path — "these whole hours (0-23), on this
// one calendar day, are the complete set this coach is available."
// hours is deliberately unbounded here (0-23, no min/max tied to court
// hours) — the grid itself only ever offers hours inside the facility's
// open/close window, so a wider range never reaches this schema in
// practice, and this validation's job is "is this shape sane," not
// re-deriving business hours a second time.
export const setDayAvailabilitySchema = z.object({
  coachId: z.string().min(1),
  date: z.coerce.date(),
  hours: z.array(z.number().int().min(0).max(23)),
});
export type SetDayAvailabilityInput = z.infer<typeof setDayAvailabilitySchema>;

export const copyWeekAvailabilitySchema = z.object({
  coachId: z.string().min(1),
  weekStart: z.coerce.date(),
});
export type CopyWeekAvailabilityInput = z.infer<typeof copyWeekAvailabilitySchema>;

export const upsertCoachRateSchema = z.object({
  coachId: z.string().min(1),
  groupSize: z.coerce.number().int().min(1, "Group size must be at least 1."),
  priceCents: z.coerce.number().int().min(0, "Price can't be negative."),
});
export type UpsertCoachRateInput = z.infer<typeof upsertCoachRateSchema>;

// source is NOT accepted from client input — same reasoning as
// Booking.source: PUBLIC/STAFF is resolved server-side from which
// action/context called createCoachSession, never trusted from the
// caller. isOutsideAvailability defaults false and is only ever honored
// on the staff path (services/coaching/coach-session.service.ts).
export const createCoachSessionSchema = z.object({
  bookingId: z.string().min(1, "Select a booking."),
  coachId: z.string().min(1, "Select a coach."),
  groupSize: z.coerce.number().int().min(1, "Group size must be at least 1."),
  isOutsideAvailability: z.boolean().optional(),
});
export type CreateCoachSessionInput = z.infer<typeof createCoachSessionSchema>;

// Owner request (2026-08-09): manually record a coach session's fee as
// collected, for a session that never got a Sale through the normal
// booking-settlement path — see coachSessionService.markSessionCollected's
// own comment. The fee itself is never re-typed here (uses the session's
// own snapshotted rateCents) — only which payment method it came in
// through.
export const markCoachSessionCollectedSchema = z.object({
  coachSessionId: z.string().min(1),
  paymentMethodId: z.string().min(1, "Choose a payment method."),
});
export type MarkCoachSessionCollectedInput = z.infer<typeof markCoachSessionCollectedSchema>;
