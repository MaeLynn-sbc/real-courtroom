import { z } from "zod";

// hourlyRateCents is intentionally required (not .optional()) in the form
// schema: z.coerce.number() on an empty string coerces to 0 rather than
// undefined, so "optional" would silently accept a blank field as ₱0
// instead of leaving the rate unset. The form always supplies a default
// (the standard rate for new courts, the existing rate when editing).

export const createCourtSchema = z.object({
  name: z.string().min(1, "Court name is required.").max(100),
  description: z.string().max(500).optional(),
  indoor: z.boolean(),
  hourlyRateCents: z.coerce.number().int().nonnegative(),
  // Staff-only 30-minute walk-in slot, flat price per court — see
  // Court.shortSessionPriceCents' own schema.prisma comment for why
  // this is per-court (matching hourlyRateCents) rather than a single
  // venue-wide setting.
  shortSessionPriceCents: z.coerce.number().int().nonnegative(),
});

export type CreateCourtInput = z.infer<typeof createCourtSchema>;

export const updateCourtSchema = z.object({
  name: z.string().min(1, "Court name is required.").max(100),
  description: z.string().max(500).optional(),
  indoor: z.boolean(),
  hourlyRateCents: z.coerce.number().int().nonnegative(),
  shortSessionPriceCents: z.coerce.number().int().nonnegative(),
});

export type UpdateCourtInput = z.infer<typeof updateCourtSchema>;

export const courtMaintenanceSchema = z
  .object({
    reason: z.string().min(1, "A reason is required.").max(200),
    notes: z.string().max(1000).optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  });

export type CourtMaintenanceInput = z.infer<typeof courtMaintenanceSchema>;

// Special events (owner request, 2026-08-08): same shape as
// courtMaintenanceSchema above, plus multi-court selection — one
// CourtMaintenance row gets created per selected court, kind:
// SPECIAL_EVENT (services/court/court.service.ts's scheduleSpecialEvent).
export const specialEventSchema = z
  .object({
    courtIds: z.array(z.string().min(1)).min(1, "Select at least one court."),
    reason: z.string().min(1, "A name is required.").max(200),
    notes: z.string().max(1000).optional(),
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
  })
  .refine((data) => data.endAt > data.startAt, {
    message: "End time must be after the start time.",
    path: ["endAt"],
  });

export type SpecialEventInput = z.infer<typeof specialEventSchema>;

export const courtStatusSchema = z.object({
  status: z.enum(["ACTIVE", "MAINTENANCE", "DISABLED"]),
});

export type CourtStatusInput = z.infer<typeof courtStatusSchema>;

export const maintenanceStatusSchema = z.object({
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
});

export type MaintenanceStatusInput = z.infer<typeof maintenanceStatusSchema>;
