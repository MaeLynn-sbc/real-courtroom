import { z } from "zod";

// Shared shape for both create and update — a full profile edit touches
// the same fields either way. name/email live on the underlying User;
// everything else lives on Player.
const playerProfileSchema = z.object({
  name: z.string().min(1, "Enter a name.").max(200),
  email: z.string().email("Enter a valid email address."),
  phone: z.string().max(50).optional(),
  bio: z.string().max(1000).optional(),
  dateOfBirth: z.coerce.date().optional(),
  skillLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"]).optional(),
  // BUILD-SPEC.md §4 — separate from skillLevel above (tournament
  // seeding); this is the open-play self-rating, prefilled into the
  // registration/check-in form next time.
  openPlaySkillLevel: z.enum(["BEGINNER", "NOVICE", "INTERMEDIATE", "ADVANCED"]).optional(),
  dominantHand: z.enum(["LEFT", "RIGHT", "AMBIDEXTROUS"]).optional(),
  position: z.enum(["LEFT", "RIGHT", "BOTH"]).optional(),
});

export const createPlayerSchema = playerProfileSchema;
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = playerProfileSchema;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

export const searchPlayersSchema = z.object({
  query: z.string().max(200).optional(),
  skillLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"]).optional(),
  hasActiveMembership: z.coerce.boolean().optional(),
});

export type SearchPlayersInput = z.infer<typeof searchPlayersSchema>;
