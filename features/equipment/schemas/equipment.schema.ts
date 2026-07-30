import { z } from "zod";

export const createEquipmentSchema = z.object({
  name: z.string().min(1, "Enter an equipment name.").max(200),
  type: z.enum(["PADDLE", "BALL", "BALL_MACHINE"]),
  quantity: z.coerce.number().int().positive("Quantity must be a positive number."),
  depositCents: z.coerce.number().int().nonnegative().optional(),
  rentalRateCents: z.coerce.number().int().nonnegative().optional(),
});

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

// Only ACTIVE/MAINTENANCE/RETIRED are staff-settable via this field —
// AVAILABLE and RENTED are computed (see equipment-condition.ts) and
// aren't meaningful things for staff to toggle by hand once a pool has
// more than one unit.
export const updateEquipmentSchema = createEquipmentSchema.extend({
  status: z.enum(["AVAILABLE", "MAINTENANCE", "RETIRED"]).optional(),
  lowStockAlertDisabled: z.boolean().optional(),
});

export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

export const createEquipmentRentalSchema = z.object({
  playerId: z.string().min(1, "Select a player."),
  dueAt: z.coerce.date().optional(),
  paymentMethodId: z.string().min(1, "Select a payment method."),
});

export type CreateEquipmentRentalInput = z.infer<typeof createEquipmentRentalSchema>;

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
