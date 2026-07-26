import { z } from "zod";

export const checkInInputSchema = z.object({
  registrationId: z.string().min(1),
});

export type CheckInInput = z.infer<typeof checkInInputSchema>;

export const registerAndCheckInInputSchema = z.object({
  sessionId: z.string().optional(),
  date: z.string().min(1).optional(),
  playerName: z.string().min(1, "Enter a name.").max(200),
  phone: z.string().min(1, "Enter a phone number.").max(50),
  skillLevel: z.enum(["BEGINNER", "NOVICE", "INTERMEDIATE", "ADVANCED"]),
  playerId: z.string().optional(),
  partyId: z.string().max(100).optional(),
  // Gate 2 review follow-up (BUILD-SPEC.md §9): optional here (unlike
  // registerWalkInInputSchema's own required fields) because this
  // schema is shared by weeknight too, where no fee applies — the
  // action validates these are actually present whenever sessionId is.
  method: z.enum(["CASH", "GCASH"]).optional(),
  gcashReference: z.string().max(100).optional(),
  paymentMethodId: z.string().optional(),
});

export type RegisterAndCheckInInput = z.infer<typeof registerAndCheckInInputSchema>;
