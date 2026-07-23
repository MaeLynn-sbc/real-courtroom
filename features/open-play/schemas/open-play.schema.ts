import { z } from "zod";

export const createOpenPlaySessionSchema = z
  .object({
    title: z.string().max(200).optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    capacity: z.coerce.number().int().positive("Capacity must be a positive number."),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  });

export type CreateOpenPlaySessionInput = z.infer<typeof createOpenPlaySessionSchema>;

// Same walk-in shape as features/bookings/schemas/booking.schema.ts —
// either an existing player or a guest name is required.
export const registerForSessionSchema = z
  .object({
    playerId: z.string().optional(),
    guestName: z.string().max(200).optional(),
    guestPhone: z.string().max(50).optional(),
  })
  .refine((data) => Boolean(data.playerId) || Boolean(data.guestName?.trim()), {
    message: "Select a player or enter a guest name.",
    path: ["guestName"],
  });

export type RegisterForSessionInput = z.infer<typeof registerForSessionSchema>;

// All 4 schema-level OpenPlaySessionStatus values are accepted here
// (matches the frozen Prisma enum exactly) — it's session.service.ts's
// state machine (services/open-play/session-status.ts) that rejects
// invalid transitions.
export const updateSessionStatusSchema = z.object({
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
});

export type UpdateSessionStatusInput = z.infer<typeof updateSessionStatusSchema>;
