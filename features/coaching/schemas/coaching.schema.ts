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
