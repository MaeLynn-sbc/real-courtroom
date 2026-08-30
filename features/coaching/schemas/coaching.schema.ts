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
  // Hours of coaching purchased. Independent of the court booking's own
  // duration — a 3-hour court booking does not imply wanting or paying
  // for 3 hours of coaching (owner decision, 2026-08-29).
  //
  // Defaults to 1 rather than the booking length, deliberately: silently
  // matching the court duration would triple a 3-hour booking's coaching
  // bill without the customer choosing it. The upper bound is enforced
  // server-side against the booking, not here, because this schema does
  // not know which booking it is for.
  // Optional at the boundary, defaulted to 1 in the service. Staff call
  // sites (the dashboard coach panel, the staff booking form) do not
  // offer an hours picker yet and must keep working unchanged; they get
  // the same 1-hour default a customer sees.
  hours: z.coerce.number().int().min(1, "Coaching must be at least 1 hour.").optional(),
  isOutsideAvailability: z.boolean().optional(),
});
export type CreateCoachSessionInput = z.infer<typeof createCoachSessionSchema>;
