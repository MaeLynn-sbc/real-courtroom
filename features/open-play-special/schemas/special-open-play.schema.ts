import { z } from "zod";

const skillLevelSchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"]).optional();

export const checkInSpecialPlayerSchema = z.object({
  date: z.string().min(1, "Pick a date."),
  playerName: z.string().min(1, "Enter a name."),
  phone: z.string().optional(),
  skillLevel: skillLevelSchema,
});
export type CheckInSpecialPlayerInput = z.infer<typeof checkInSpecialPlayerSchema>;

export const assignSpecialPlayerToCourtSchema = z.object({
  checkInId: z.string().min(1),
  courtLabel: z.string().min(1, "Choose a court."),
});
export type AssignSpecialPlayerToCourtInput = z.infer<typeof assignSpecialPlayerToCourtSchema>;

export const specialCheckInIdSchema = z.object({
  checkInId: z.string().min(1),
});
export type SpecialCheckInIdInput = z.infer<typeof specialCheckInIdSchema>;
