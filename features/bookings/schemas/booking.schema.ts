import { z } from "zod";

// Only HOURLY and WALK_IN are creatable through this phase's UI — RECURRING,
// PRIVATE, and MAINTENANCE_BLOCK stay valid BookingType values in the
// database (frozen schema) but aren't exposed here. Restricting the enum
// server-side, not just in the UI, is intentional defense in depth.
//
// Settle-bill (pay-at-venue gap fix): no paymentMethodId here anymore —
// the customer's actual payment method isn't known at booking time (they
// might pay cash or GCash whenever they actually settle up, not
// necessarily the moment the booking is made), so nothing about payment
// gets recorded here. A booking is always created unpaid; settling is
// its own separate action (settleBookingAction) taken at the moment
// money actually changes hands. See booking.service.ts's createBooking
// and settleBooking for the full reasoning.
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

// Settle-bill: mirrors player-tab.service.ts's settleTab shape exactly
// (method + conditionally-required gcashReference). Validated again at
// the service layer (gcashReference required when method is GCASH) since
// that's a cross-field rule this schema also enforces, defense in depth
// same as every other money-creating action in this app.
export const settleBookingSchema = z
  .object({
    bookingId: z.string().min(1),
    method: z.enum(["CASH", "GCASH"]),
    gcashReference: z.string().max(200).optional(),
    paymentMethodId: z.string().min(1, "Select a payment method."),
    // Optional photo of the physical receipt/GCash confirmation — same
    // base64-over-the-action shape as submitBookingPaymentProof.
    receipt: z
      .object({
        fileName: z.string().min(1),
        contentType: z.string().min(1),
        dataBase64: z.string().min(1),
      })
      .optional(),
  })
  .refine((data) => data.method !== "GCASH" || Boolean(data.gcashReference?.trim()), {
    message: "A GCash reference number is required.",
    path: ["gcashReference"],
  });

export type SettleBookingInput = z.infer<typeof settleBookingSchema>;

// All 11 schema-level BookingStatus values are accepted here (matches the
// frozen Prisma enum exactly) — it's BookingService's state machine
// (services/booking/booking-status.ts), not this schema, that rejects
// transitions into PAID or otherwise-invalid transitions. The Phase 8
// plumbing additions (AWAITING_PAYMENT/PENDING_VERIFICATION/REJECTED/
// REFUNDED) are listed here for the same reason PAID always was — this
// schema's job is "is this a real enum value," not "is this transition
// currently reachable" — and stay unreachable in practice because
// BOOKING_STATUS_TRANSITIONS has no entry transitioning into any of them
// yet (Gate 1 is schema-only; see that file's comment for the real graph
// Gate 2 wires in).
export const updateBookingStatusSchema = z.object({
  status: z.enum([
    "PENDING",
    "CONFIRMED",
    "PAID",
    "CHECKED_IN",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
    "AWAITING_PAYMENT",
    "PENDING_VERIFICATION",
    "REJECTED",
    "REFUNDED",
  ]),
  note: z.string().max(500).optional(),
});

export type UpdateBookingStatusInput = z.infer<typeof updateBookingStatusSchema>;

export const checkInByTokenSchema = z.object({
  token: z.string().min(1, "Enter or scan a check-in code."),
});

export type CheckInByTokenInput = z.infer<typeof checkInByTokenSchema>;

// "Customer changed their mind... rather play in further court" — same
// time slot, a different court.
export const changeBookingCourtSchema = z.object({
  bookingId: z.string().min(1),
  newCourtId: z.string().min(1, "Choose a court."),
});

export type ChangeBookingCourtInput = z.infer<typeof changeBookingCourtSchema>;

// Owner request (2026-08-25): staff move a booking's court AND/OR time,
// including one paid through the website. Every field optional so the
// caller sends only what changed; the service refuses a no-op, a past
// start, and — on an already-paid booking — any change of duration.
export const changeBookingSlotSchema = z
  .object({
    bookingId: z.string().min(1),
    newCourtId: z.string().min(1).optional(),
    newStartAt: z.coerce.date().optional(),
    newEndAt: z.coerce.date().optional(),
  })
  .refine((data) => Boolean(data.newStartAt) === Boolean(data.newEndAt), {
    message: "Pick both a start and an end time.",
    path: ["newEndAt"],
  })
  .refine((data) => data.newCourtId || data.newStartAt, {
    message: "Choose a different court or time.",
    path: ["newCourtId"],
  });

export type ChangeBookingSlotInput = z.infer<typeof changeBookingSlotSchema>;
