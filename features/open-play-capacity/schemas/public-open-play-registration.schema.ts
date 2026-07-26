import { z } from "zod";

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
  date: z.string().min(1, "Select a date."),
});

export type PublicOpenPlayRegistrationInput = z.infer<typeof publicOpenPlayRegistrationSchema>;
