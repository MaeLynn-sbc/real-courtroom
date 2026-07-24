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
});

export type RegisterAndCheckInInput = z.infer<typeof registerAndCheckInInputSchema>;
