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
    // Owner request (2026-08-05): unchecked for an outside event where
    // entrants already paid the organizers directly — see the schema
    // column's own comment for why this defaults true.
    collectsPaymentOnSite: z.boolean().default(true),
  })
  .refine((data) => data.endDate >= data.startDate, {
    message: "End date must be on or after the start date.",
    path: ["endDate"],
  });

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

export const updateTournamentPaymentSettingSchema = z.object({
  collectsPaymentOnSite: z.boolean(),
});

export type UpdateTournamentPaymentSettingInput = z.infer<
  typeof updateTournamentPaymentSettingSchema
>;

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
// staff uses the category name as the convention. Typed names, not a
// Player picker (owner, 2026-08-03) — tournament entrants are
// frequently walk-ins with no existing Player record; registerTeam
// creates a minimal one on the spot for each name.
// paymentMethodId is optional at the schema level — required only when
// the tournament actually collects payment on-site (see
// Tournament.collectsPaymentOnSite); enforced in tournamentService.
// registerTeam, the one place that already knows the tournament's
// setting, not duplicated here where it doesn't.
export const registerTeamSchema = z.object({
  player1Name: z.string().min(1, "Enter player 1's name.").max(200),
  player2Name: z.string().max(200).optional(),
  paymentMethodId: z.string().optional(),
  receipt: z
    .object({
      fileName: z.string().min(1),
      contentType: z.string().min(1),
      dataBase64: z.string().min(1),
    })
    .optional(),
});

export type RegisterTeamInput = z.infer<typeof registerTeamSchema>;

// Owner request (2026-08-05): "add option to delete and edit, to those
// who cancelled or typo errors." Edit only ever corrects the typed
// name(s) already on the team — it can't add/remove a player2 (singles
// vs. doubles is a structural change, out of scope for "fix a typo").
// player2Name is required here (not optional, unlike registerTeamSchema)
// only when the team already has a player2 — enforced in
// tournamentService.updateRegistrationPlayerNames, which is the one
// place that knows whether the team is doubles.
export const updateRegistrationPlayerNamesSchema = z.object({
  player1Name: z.string().min(1, "Enter player 1's name.").max(200),
  player2Name: z.string().max(200).optional(),
});

export type UpdateRegistrationPlayerNamesInput = z.infer<
  typeof updateRegistrationPlayerNamesSchema
>;

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
