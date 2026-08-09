import { z } from "zod";

const skillLevelSchema = z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"]).optional();

export const checkInSpecialPlayerSchema = z.object({
  date: z.string().min(1, "Pick a date."),
  playerName: z.string().min(1, "Enter a name."),
  phone: z.string().optional(),
  skillLevel: skillLevelSchema,
});
export type CheckInSpecialPlayerInput = z.infer<typeof checkInSpecialPlayerSchema>;

// Owner request (2026-08-09): "like i can form a group and put it to
// court a" — up to 4 waiting players assigned to one court together, in
// one action.
export const assignSpecialGroupToCourtSchema = z.object({
  checkInIds: z.array(z.string().min(1)).min(1, "Select at least one player.").max(4),
  courtLabel: z.string().min(1, "Choose a court."),
});
export type AssignSpecialGroupToCourtInput = z.infer<typeof assignSpecialGroupToCourtSchema>;

export const specialCourtActionSchema = z.object({
  date: z.string().min(1),
  courtLabel: z.string().min(1),
});
export type SpecialCourtActionInput = z.infer<typeof specialCourtActionSchema>;

export const specialCheckInIdSchema = z.object({
  checkInId: z.string().min(1),
});
export type SpecialCheckInIdInput = z.infer<typeof specialCheckInIdSchema>;

// Owner request (2026-08-09): "can we also add next up. then next
// then" — manual staging only, no auto-queue.
export const stageSpecialGroupSchema = z.object({
  checkInIds: z.array(z.string().min(1)).min(1, "Select at least one player.").max(4),
  slot: z.enum(["NEXT_UP", "AFTER_THAT", "THEN"]),
});
export type StageSpecialGroupInput = z.infer<typeof stageSpecialGroupSchema>;

export const specialStagedSlotActionSchema = z.object({
  date: z.string().min(1),
  slot: z.enum(["NEXT_UP", "AFTER_THAT", "THEN"]),
});
export type SpecialStagedSlotActionInput = z.infer<typeof specialStagedSlotActionSchema>;

// Owner request (2026-08-09): "can i manually add player" (in every
// staging box) — check a new player straight into a slot in one step.
export const checkInSpecialPlayerToSlotSchema = z.object({
  date: z.string().min(1, "Pick a date."),
  playerName: z.string().min(1, "Enter a name."),
  phone: z.string().optional(),
  skillLevel: skillLevelSchema,
  slot: z.enum(["NEXT_UP", "AFTER_THAT", "THEN"]),
});
export type CheckInSpecialPlayerToSlotInput = z.infer<typeof checkInSpecialPlayerToSlotSchema>;
