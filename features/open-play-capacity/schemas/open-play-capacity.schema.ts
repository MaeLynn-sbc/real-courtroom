import { z } from "zod";

// BUILD-SPEC.md §4 "Accept any positive integer. Do not cap input at 40 —
// values like 42 must be allowed." No .max() on either schema below.
const positiveCapacitySchema = z
  .number()
  .int()
  .positive("Capacity must be a positive whole number.");

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

// Date-specific override on top of the day-of-week default above —
// "this particular Friday is a tournament, no online registration
// that night" even though Fridays are normally open.
export const onlineRegistrationBlockedForDateInputSchema = z.object({
  date: z.string().min(1, "Choose a date."),
  blocked: z.boolean(),
});

export type OnlineRegistrationBlockedForDateInput = z.infer<
  typeof onlineRegistrationBlockedForDateInputSchema
>;

// Per-date closed-registration message override — independent of the
// block toggle above (see OpenPlayCapacityService.setClosedMessageForDate's
// own comment). No .min() — an empty string is a valid, meaningful input
// here: it's how a per-date message gets cleared back to the global
// default, not an invalid one.
export const closedMessageForDateInputSchema = z.object({
  date: z.string().min(1, "Choose a date."),
  message: z.string().max(200, "Keep it under 200 characters."),
});

export type ClosedMessageForDateInput = z.infer<typeof closedMessageForDateInputSchema>;

// Owner request (2026-08-08): "sometimes we want to have open play at
// earlier times" — a per-date override of when a specific Fri/Sat night's
// court-booking cutoff (and walk-in registration mode switch) kicks in.
// "HH:MM" (24h), same format every other time-of-day setting in this file's
// sibling schema (CourtHoursSettings) already uses — validated as a real
// time, not just any string, since it flows straight into
// parseTimeToMinutes.
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const startTimeOverrideInputSchema = z.object({
  date: z.string().min(1, "Choose a date."),
  startTime: z.string().regex(TIME_PATTERN, "Enter a valid time (HH:MM)."),
});

export type StartTimeOverrideInput = z.infer<typeof startTimeOverrideInputSchema>;

export const resetStartTimeInputSchema = z.object({
  date: z.string().min(1, "Choose a date."),
});

export type ResetStartTimeInput = z.infer<typeof resetStartTimeInputSchema>;
