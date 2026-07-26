import { z } from "zod";

// BUILD-SPEC.md §4 "Accept any positive integer. Do not cap input at 40 —
// values like 42 must be allowed." No .max() on either schema below.
const positiveCapacitySchema = z.number().int().positive("Capacity must be a positive whole number.");

export const capacityDefaultInputSchema = z.object({
  dayOfWeek: z.union([z.literal(5), z.literal(6)]),
  capacity: positiveCapacitySchema,
});

export type CapacityDefaultInput = z.infer<typeof capacityDefaultInputSchema>;

export const sessionCapacityOverrideInputSchema = z.object({
  date: z.string().min(1, "Choose a date."),
  capacity: positiveCapacitySchema,
});

export type SessionCapacityOverrideInput = z.infer<typeof sessionCapacityOverrideInputSchema>;

// Open-play online self-registration, Gate 1 follow-up (BUILD-SPEC.md
// §6) — which capacity night(s) offer online registration, independent
// of the capacity number itself.
export const onlineRegistrationEnabledInputSchema = z.object({
  dayOfWeek: z.union([z.literal(5), z.literal(6)]),
  enabled: z.boolean(),
});

export type OnlineRegistrationEnabledInput = z.infer<typeof onlineRegistrationEnabledInputSchema>;
