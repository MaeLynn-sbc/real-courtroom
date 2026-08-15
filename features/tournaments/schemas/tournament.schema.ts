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

// Owner report (2026-08-15), LIVE during the tournament: "if i put the
// team to no court from court 1 and then reassign again to court 1 it
// doesnt go thru... court 1 is not available for other teams" —
// courtId used to only be `optional()` (allows undefined, not null),
// but Prisma treats an `undefined` field as "leave unchanged," not
// "clear it." The Scoresheet's "No court" option sends courtId: null
// specifically to clear it — nullable() lets that through so
// match.service.ts's scheduleMatch can pass it straight to Prisma,
// which DOES respect an explicit null as "set this column to NULL."
export const scheduleMatchSchema = z.object({
  courtId: z.string().nullable().optional(),
  scheduledAt: z.coerce.date().optional(),
});

export type ScheduleMatchInput = z.infer<typeof scheduleMatchSchema>;

export const stageMatchSchema = z.object({
  slot: z.enum(["NEXT_UP", "AFTER_THAT", "THEN"]),
});

export type StageMatchInput = z.infer<typeof stageMatchSchema>;

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

// Owner request (2026-08-11): the actual draw/grouping happens live on
// an external wheel-of-fortune site so everyone can watch — this just
// needs to record whatever pairing that produces, one at a time, not
// generate any pairing itself. round is optional so matches from
// different rounds/pools can still be told apart in BracketView's own
// groupByRound display; omitted matches fall into "Round 0" same as
// any other round-less Match already does elsewhere in this schema.
export const createManualMatchSchema = z
  .object({
    team1Id: z.string().min(1, "Select the first team."),
    team2Id: z.string().min(1, "Select the second team."),
    round: z.coerce.number().int().positive().optional(),
  })
  .refine((data) => data.team1Id !== data.team2Id, {
    message: "Pick two different teams.",
    path: ["team2Id"],
  });

export type CreateManualMatchInput = z.infer<typeof createManualMatchSchema>;

// Owner request (2026-08-11): "create 2 brackets with option of 3 or 4
// or equally divide the players for the bracket created. then it will
// auto create the match" — poolCount is always what the service acts
// on; the "3 or 4 teams per pool" phrasing is a UI-only alternate input
// mode (features/tournaments/components/pool-assignment-form.tsx
// computes poolCount = ceil(confirmedCount / teamsPerPool) before
// calling this action), not a second server-side shape.
export const createPoolsSchema = z.object({
  poolCount: z.coerce.number().int().min(1, "Enter at least 1 pool."),
});

export type CreatePoolsInput = z.infer<typeof createPoolsSchema>;

// Owner request (2026-08-11): "i want to edit and manually add teams"
// — moves one team at a time, as the external wheel-of-fortune draw
// names it. poolLabel is a free-typed string (not constrained to
// A/B/C), since staff might label pools however the live draw does;
// null clears the team back to unassigned.
export const setTeamPoolSchema = z.object({
  teamId: z.string().min(1),
  poolLabel: z.string().trim().min(1).max(50).nullable(),
});

export type SetTeamPoolInput = z.infer<typeof setTeamPoolSchema>;

// Owner request (2026-08-13): "can i hva a pool players list. edit it
// and change it" — a real correction path for AFTER a bracket already
// exists, unlike setTeamPool above (which correctly refuses once
// matches exist — see tournamentService.setTeamPool's own comment).
// poolLabel and poolPosition always travel together here: both null
// clears the team back to unassigned, both set corrects it — there's
// no "auto-append to the end of the pool" here the way createPools/
// setTeamPool have, since the whole point of this path is manually
// fixing a specific number to match reality (e.g. the real wheel-of-
// fortune draw), not drawing a fresh one.
export const correctTeamPoolAssignmentSchema = z
  .object({
    teamId: z.string().min(1),
    poolLabel: z.string().trim().min(1).max(50).nullable(),
    poolPosition: z.number().int().positive().nullable(),
  })
  .refine((data) => (data.poolLabel === null) === (data.poolPosition === null), {
    message: "A pool and a position must be set together, or both cleared.",
  });

export type CorrectTeamPoolAssignmentInput = z.infer<typeof correctTeamPoolAssignmentSchema>;
