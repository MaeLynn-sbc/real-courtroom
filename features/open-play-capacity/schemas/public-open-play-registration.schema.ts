import { z } from "zod";

const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

// Open-play online self-registration, Gate 2 (BUILD-SPEC.md §6).
// Customer-facing shape — no sessionId (resolved server-side from
// `date`, same as public-booking.schema.ts resolves a court from
// courtId but never lets the client name a session/hold directly), no
// source (hardcoded WEBSITE server-side, never read from this input).
export const publicOpenPlayRegistrationSchema = z.object({
  playerName: z.string().min(1, "Enter your name.").max(200),
  phone: z.string().min(1, "Enter your phone number.").max(50),
  // BUILD-SPEC.md §4: required for every open play registration.
  skillLevel: z.enum(["BEGINNER", "NOVICE", "INTERMEDIATE", "ADVANCED"]),
  // Gate 2 review follow-up: a real, static shape check (well-formed
  // YYYY-MM-DD, a real calendar date) rather than bare non-empty — this
  // catches malformed input before it ever reaches `new Date(...)`. The
  // OTHER date constraint this feature needs — "is this date within the
  // owner's registration lead-time window" — is deliberately NOT here:
  // it depends on a runtime setting
  // (openPlaySettingsSchema.onlineRegistrationLeadTimeDays) a static zod
  // schema can't see, so it's enforced authoritatively in
  // createPublicOpenPlayRegistration instead, same as capacity/holds are
  // always service-side, never schema-side, because they need live data.
  date: z
    .string()
    .min(1, "Select a date.")
    .regex(DATE_FORMAT, "Select a valid date.")
    .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00`).getTime()), "Select a valid date."),
});

export type PublicOpenPlayRegistrationInput = z.infer<typeof publicOpenPlayRegistrationSchema>;
