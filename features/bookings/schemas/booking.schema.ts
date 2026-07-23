import { z } from "zod";

// Only HOURLY and WALK_IN are creatable through this phase's UI — RECURRING,
// PRIVATE, and MAINTENANCE_BLOCK stay valid BookingType values in the
// database (frozen schema) but aren't exposed here. Restricting the enum
// server-side, not just in the UI, is intentional defense in depth.
export const createBookingSchema = z
  .object({
    courtId: z.string().min(1, "Select a court."),
    type: z.enum(["HOURLY", "WALK_IN"]),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    playerId: z.string().optional(),
    guestName: z.string().max(200).optional(),
    guestPhone: z.string().max(50).optional(),
    guestEmail: z.string().email().max(200).optional(),
    notes: z.string().max(1000).optional(),
    paymentMethodId: z.string().min(1, "Select a payment method."),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  })
  .refine((data) => Boolean(data.playerId) || Boolean(data.guestName?.trim()), {
    message: "Select a player or enter a guest name.",
    path: ["guestName"],
  });

export type CreateBookingInput = z.infer<typeof createBookingSchema>;

// All 7 schema-level BookingStatus values are accepted here (matches the
// frozen Prisma enum exactly) — it's BookingService's state machine
// (services/booking/booking-status.ts), not this schema, that rejects
// transitions into PAID or otherwise-invalid transitions.
export const updateBookingStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "PAID",
    "CHECKED_IN",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ]),
  note: z.string().max(500).optional(),
});

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

export const checkInByTokenSchema = z.object({
  token: z.string().min(1, "Enter or scan a check-in code."),
});

export type CheckInByTokenInput = z.infer<typeof checkInByTokenSchema>;
