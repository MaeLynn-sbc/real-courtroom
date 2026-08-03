import { z } from "zod";

export const createTournamentSchema = z
  .object({
    name: z.string().min(1, "Enter a tournament name.").max(200),
    description: z.string().max(2000).optional(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    registrationOpensAt: z.coerce.date().optional(),
    registrationClosesAt: z.coerce.date().optional(),
    venueInfo: z.string().max(500).optional(),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

// All 6 schema-level TournamentStatus values are accepted here (matches
// the frozen Prisma enum exactly) — it's tournament.service.ts's state
// machine (services/tournaments/tournament-status.ts) that rejects
// invalid transitions.
export const updateTournamentStatusSchema = z.object({
  status: z.enum([
    "DRAFT",
    "REGISTRATION_OPEN",
    "REGISTRATION_CLOSED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
  ]),
});

export type UpdateTournamentStatusInput = z.infer<typeof updateTournamentStatusSchema>;

// Only ROUND_ROBIN and SINGLE_ELIMINATION are creatable through this
// phase's UI — DOUBLE_ELIMINATION and POOL_PLAY stay valid, unused
// TournamentFormat values (same precedent as Booking restricting
// creatable BookingType). Enforced here, not just hidden in the form.
export const createCategorySchema = z.object({
  name: z.string().min(1, "Enter a category name.").max(200),
  format: z.enum(["ROUND_ROBIN", "SINGLE_ELIMINATION"]),
  division: z.enum(["MENS", "WOMENS", "MIXED", "OPEN"]),
  skillLevel: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED", "PRO"]).optional(),
  feeCents: z.coerce.number().int().nonnegative().optional(),
  maxTeams: z.coerce.number().int().positive().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

// Same optional-number shape as createCategorySchema's own maxTeams —
// undefined/blank means "clear the limit," not "leave unchanged" (the
// form always sends the field's current intended value, never omits it
// to mean no-op).
export const updateCategoryMaxTeamsSchema = z.object({
  maxTeams: z.coerce.number().int().positive().optional(),
});

export type UpdateCategoryMaxTeamsInput = z.infer<typeof updateCategoryMaxTeamsSchema>;

// Team size is intentionally unenforced against the category (see
// ARCHITECTURE.md's Phase 6 addendum) — 1 or 2 players is always valid,
// staff uses the category name as the convention.
export const registerTeamSchema = z.object({
  player1Id: z.string().min(1, "Select a player."),
  player2Id: z.string().optional(),
  paymentMethodId: z.string().min(1, "Select a payment method."),
  receipt: z
    .object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      dataBase64: z.string().min(1),
    })
    .optional(),
});

export type RegisterTeamInput = z.infer<typeof registerTeamSchema>;

export const scheduleMatchSchema = z.object({
  courtId: z.string().optional(),
  scheduledAt: z.coerce.date().optional(),
});

export type ScheduleMatchInput = z.infer<typeof scheduleMatchSchema>;

export const recordScoreSchema = z.object({
  setNumber: z.coerce.number().int().positive(),
  team1Score: z.coerce.number().int().nonnegative(),
  team2Score: z.coerce.number().int().nonnegative(),
});

export type RecordScoreInput = z.infer<typeof recordScoreSchema>;

export const markWalkoverSchema = z.object({
  winnerTeamId: z.string().min(1, "Select the winning team."),
});

export type MarkWalkoverInput = z.infer<typeof markWalkoverSchema>;
