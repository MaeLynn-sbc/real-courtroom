import { z } from "zod";

export const createLockerSchema = z.object({
  code: z.string().min(1, "Enter a locker code.").max(50),
});

export type CreateLockerInput = z.infer<typeof createLockerSchema>;

// OCCUPIED and RESERVED are computed (see locker-status.ts) — staff can
// only toggle the administrative states.
export const updateLockerSchema = z.object({
  code: z.string().min(1, "Enter a locker code.").max(50),
  status: z.enum(["AVAILABLE", "MAINTENANCE", "DISABLED"]).optional(),
});

export type UpdateLockerInput = z.infer<typeof updateLockerSchema>;

export const createLockerRentalSchema = z
  .object({
    playerId: z.string().min(1, "Select a player."),
    type: z.enum(["DAILY", "MONTHLY"]),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    amountCents: z.coerce.number().int().nonnegative().optional(),
    paymentMethodId: z.string().min(1, "Select a payment method."),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  });

export type CreateLockerRentalInput = z.infer<typeof createLockerRentalSchema>;

export const logMaintenanceSchema = z.object({
  logType: z.enum(["ROUTINE", "DAMAGE_REPORT", "REPAIR", "REPLACEMENT"]),
  note: z.string().min(1, "Enter a note.").max(1000),
  performedAt: z.coerce.date().optional(),
});

export type LogMaintenanceInput = z.infer<typeof logMaintenanceSchema>;

export const resolveMaintenanceSchema = z.object({
  note: z.string().max(1000).optional(),
});

export type ResolveMaintenanceInput = z.infer<typeof resolveMaintenanceSchema>;
