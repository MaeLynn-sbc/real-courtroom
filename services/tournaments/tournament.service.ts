import type {
  CreateCategoryInput,
  CreateTournamentInput,
  RegisterTeamInput,
  UpdateRegistrationPlayerNamesInput,
} from "@/features/tournaments/schemas/tournament.schema";
import type {
  Match,
  Prisma,
  Tournament,
  TournamentCategory,
  TournamentRegistration,
} from "@/lib/generated/prisma/client";
import type { TournamentStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { saleService } from "@/services/sales/sale.service";
import {
  dividePoolsEvenly,
  generateRoundRobinPairings,
  generateSingleEliminationRound1,
} from "@/services/tournaments/bracket-generator";
import { canTransitionTournamentStatus } from "@/services/tournaments/tournament-status";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { SYSTEM_ROLES } from "@/types/roles";

// v1.1 Sub-phase 2: every registration is created by a signed-in Employee
// with a currently open Shift, and pays through one of the configured
// PaymentMethod rows — registerTeamAction resolves both before calling in.
export interface RegisterTeamSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

export interface RegisterTeamReceiptInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

interface ListTournamentsFilters {
  status?: TournamentStatus;
}

// A registration "holds a confirmed slot" the same way Open Play's
// SLOT_HOLDING_STATUSES does — only CONFIRMED counts toward maxTeams and
// toward bracket generation eligibility.
export class TournamentService {
  async listTournaments(filters?: ListTournamentsFilters) {
    return prisma.tournament.findMany({
      where: filters?.status ? { status: filters.status, deletedAt: null } : { deletedAt: null },
      orderBy: { startDate: "desc" },
    });
  }

  async listTournamentHistory() {
    return prisma.tournament.findMany({
      where: { status: { in: ["COMPLETED", "CANCELLED"] }, deletedAt: null },
      orderBy: { startDate: "desc" },
    });
  }

  async getTournamentById(tournamentId: string) {
    return prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        categories: {
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { registrations: true, matches: true } } },
        },
      },
    });
  }

  // Public home-page teaser + /tournaments/[id] page (owner, 2026-08-04):
  // "bracketing is done" reuses the exact same signal the staff dashboard
  // already computes (bracketGenerated = matches.length > 0) rather than
  // a second concept of "ready" — a category still in registration-only
  // has no bracket to show publicly, so it's excluded entirely, not shown
  // half-empty. DRAFT/CANCELLED tournaments never qualify regardless of
  // their categories' state.
  async listPublicTournamentsWithBrackets() {
    const tournaments = await prisma.tournament.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ["DRAFT", "CANCELLED"] },
        categories: { some: { matches: { some: {} } } },
      },
      include: {
        categories: {
          where: { matches: { some: {} } },
          orderBy: { createdAt: "asc" },
          include: { _count: { select: { registrations: true, matches: true } } },
        },
      },
      orderBy: { startDate: "desc" },
    });
    return tournaments;
  }

  async getCategoryById(categoryId: string) {
    return prisma.tournamentCategory.findUnique({
      where: { id: categoryId },
      include: {
        tournament: true,
        registrations: {
          orderBy: { registeredAt: "asc" },
          include: {
            team: {
              include: {
                player1: { include: { user: { select: { id: true, name: true, email: true } } } },
                player2: { include: { user: { select: { id: true, name: true, email: true } } } },
              },
            },
            // Owner request (2026-08-05): the Delete button only shows
            // when there's no recorded payment to protect — see
            // deleteRegistration's own comment for why that's enforced.
            sale: { select: { id: true } },
          },
        },
      },
    });
  }

  async createTournament(input: CreateTournamentInput, actorUserId: string): Promise<Tournament> {
    const tournament = await prisma.tournament.create({
      data: {
        name: input.name,
        description: input.description,
        createdById: actorUserId,
        startDate: input.startDate,
        endDate: input.endDate,
        registrationOpensAt: input.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt,
        venueInfo: input.venueInfo,
        collectsPaymentOnSite: input.collectsPaymentOnSite,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.created",
      entityType: "Tournament",
      entityId: tournament.id,
      newValues: tournament,
    });

    return tournament;
  }

  async updateTournament(
    tournamentId: string,
    input: CreateTournamentInput,
    actorUserId: string,
  ): Promise<Tournament> {
    const existing = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    const tournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: {
        name: input.name,
        description: input.description,
        startDate: input.startDate,
        endDate: input.endDate,
        registrationOpensAt: input.registrationOpensAt,
        registrationClosesAt: input.registrationClosesAt,
        venueInfo: input.venueInfo,
        collectsPaymentOnSite: input.collectsPaymentOnSite,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.updated",
      entityType: "Tournament",
      entityId: tournament.id,
      oldValues: existing,
      newValues: tournament,
    });

    return tournament;
  }

  // Narrow, single-field update — same precedent as
  // updateCategoryMaxTeams — for the tournament detail page's own
  // toggle, so flipping this one setting doesn't need the full
  // create/update form's entire field set round-tripped.
  async updateTournamentPaymentSetting(
    tournamentId: string,
    collectsPaymentOnSite: boolean,
    actorUserId: string,
  ): Promise<Tournament> {
    const existing = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    const tournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: { collectsPaymentOnSite },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.payment_setting_updated",
      entityType: "Tournament",
      entityId: tournament.id,
      oldValues: { collectsPaymentOnSite: existing.collectsPaymentOnSite },
      newValues: { collectsPaymentOnSite: tournament.collectsPaymentOnSite },
    });

    return tournament;
  }

  // Owner request (2026-08-15): "use their logo" — the organizer's own
  // branding, shown on /tourtv (not a hardcoded image; uploaded once,
  // shown until changed). logoUrl null clears it back to plain text.
  async updateTournamentLogo(
    tournamentId: string,
    logoUrl: string | null,
    actorUserId: string,
  ): Promise<Tournament> {
    const existing = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    const tournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: { logoUrl },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.logo_updated",
      entityType: "Tournament",
      entityId: tournament.id,
      oldValues: { logoUrl: existing.logoUrl },
      newValues: { logoUrl: tournament.logoUrl },
    });

    return tournament;
  }

  async updateTournamentStatus(
    tournamentId: string,
    status: TournamentStatus,
    actorUserId: string,
  ): Promise<Tournament> {
    const existing = await prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });

    if (!canTransitionTournamentStatus(existing.status, status)) {
      throw new Error(`Cannot move a tournament from ${existing.status} to ${status}.`);
    }

    const tournament = await prisma.tournament.update({
      where: { id: tournamentId },
      data: { status },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.status_changed",
      entityType: "Tournament",
      entityId: tournament.id,
      oldValues: { status: existing.status },
      newValues: { status: tournament.status },
    });

    return tournament;
  }

  async createCategory(
    tournamentId: string,
    input: CreateCategoryInput,
    actorUserId: string,
  ): Promise<TournamentCategory> {
    const category = await prisma.tournamentCategory.create({
      data: {
        tournamentId,
        name: input.name,
        format: input.format,
        division: input.division,
        skillLevel: input.skillLevel,
        feeCents: input.feeCents ?? 0,
        maxTeams: input.maxTeams,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.category_created",
      entityType: "TournamentCategory",
      entityId: category.id,
      newValues: category,
    });

    return category;
  }

  // Set after creation — createCategory's own maxTeams field is optional,
  // and there was previously no way back to it once a category existed
  // (reported live: staff landed on the category detail page with no
  // option to set it at all). null clears the limit (unlimited teams),
  // same "empty means unset" convention createCategory's own optional
  // maxTeams already uses. Deliberately NOT retroactive — changing this
  // doesn't re-evaluate already-CONFIRMED registrations; createRegistration
  // (below) reads maxTeams fresh only for the NEXT registration, same as
  // every other capacity-limit setting in this app (e.g. Open Play's
  // OpenPlayCapacityDefault).
  async updateCategoryMaxTeams(
    categoryId: string,
    maxTeams: number | null,
    actorUserId: string,
  ): Promise<TournamentCategory> {
    const existing = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    const updated = await prisma.tournamentCategory.update({
      where: { id: categoryId },
      data: { maxTeams },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.category_max_teams_updated",
      entityType: "TournamentCategory",
      entityId: categoryId,
      oldValues: { maxTeams: existing.maxTeams },
      newValues: { maxTeams },
    });

    return updated;
  }

  // v1.1 Sub-phase 2: wrapped in a transaction (previously three separate
  // un-transacted writes) so the Team/Registration rows and their Sale are
  // always created atomically — never one without the other. v1.1
  // maintenance: Sale's saleNumber now comes from the shared atomic
  // counter (lib/reference-counter.ts) and can no longer collide, so the
  // retry loop this used to need solely for that is gone.
  // saleContext is null for a tournament that doesn't collect payment
  // on-site (Tournament.collectsPaymentOnSite === false — an outside
  // event where entrants already paid the organizers directly). The
  // registration itself is still recorded exactly as normal (CONFIRMED/
  // WAITLISTED against maxTeams); only the Sale is skipped, so there's
  // no employeeId/shiftId/paymentMethodId to require in that case
  // either — see registerTeamAction's own comment for how it decides
  // which case it's in before this is ever called.
  async registerTeam(
    categoryId: string,
    input: RegisterTeamInput,
    actorUserId: string,
    saleContext: RegisterTeamSaleContext | null,
    receipt?: RegisterTeamReceiptInput,
  ): Promise<TournamentRegistration> {
    const category = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });
    const memberRole = await prisma.role.findUniqueOrThrow({
      where: { name: SYSTEM_ROLES.MEMBER },
    });

    // Same upload-then-write-then-cleanup-on-failure shape as
    // ExpenseService.createExpense — the file lands in storage first (so
    // its key exists for the DB write), and is deleted if the DB write
    // never lands, so a failed submission never leaves an orphaned file.
    const upload = receipt
      ? await getUploadService().uploadPrivate({
          fileName: receipt.fileName,
          contentType: receipt.contentType,
          data: receipt.data,
        })
      : null;

    try {
      const { registration, sale } = await prisma.$transaction(async (tx) => {
        // "No dropdown — manually type both names" (owner, 2026-08-03):
        // tournament entrants are frequently walk-ins with no existing
        // Player record, so instead of picking from the Player list,
        // staff type each name directly and a real minimal Player (+
        // its underlying User) is created here on the spot — no email,
        // same as playerService.createPlayer's User.create shape, just
        // inlined in this transaction rather than opening a second one.
        // Deliberately always creates fresh rows rather than matching an
        // existing name (name collisions/typos make that unreliable) —
        // the accepted tradeoff is that a repeat walk-in gets a new
        // Player row each tournament, same as a paper sign-up sheet
        // would never dedupe them either.
        async function createWalkInPlayer(name: string) {
          const user = await tx.user.create({ data: { name, roleId: memberRole.id } });
          return tx.player.create({ data: { userId: user.id } });
        }

        const player1 = await createWalkInPlayer(input.player1Name);
        const player2 = input.player2Name ? await createWalkInPlayer(input.player2Name) : null;

        const team = await tx.team.create({
          data: { player1Id: player1.id, player2Id: player2?.id },
        });

        const confirmedCount = await tx.tournamentRegistration.count({
          where: { tournamentCategoryId: categoryId, status: "CONFIRMED" },
        });

        const status =
          category.maxTeams && confirmedCount >= category.maxTeams ? "WAITLISTED" : "CONFIRMED";

        const createdRegistration = await tx.tournamentRegistration.create({
          data: {
            tournamentCategoryId: categoryId,
            teamId: team.id,
            status,
            receiptStorageKey: upload?.key,
          },
        });

        const createdSale = saleContext
          ? await saleService.createSale(
              {
                category: "TOURNAMENT_REGISTRATION",
                amountCents: category.feeCents,
                paymentMethodId: saleContext.paymentMethodId,
                employeeId: saleContext.employeeId,
                shiftId: saleContext.shiftId,
                playerId: player1.id,
                tournamentRegistrationId: createdRegistration.id,
              },
              tx,
            )
          : null;

        return { registration: createdRegistration, sale: createdSale };
      });

      await this.writeAuditLog({
        actorUserId,
        action: "tournament.team_registered",
        entityType: "TournamentRegistration",
        entityId: registration.id,
        newValues: registration,
      });
      if (sale) {
        await saleService.logSaleCreated(sale, actorUserId);
      }

      return registration;
    } catch (error) {
      if (upload) {
        await getUploadService()
          .delete(upload.key)
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async cancelRegistration(
    registrationId: string,
    actorUserId: string,
  ): Promise<TournamentRegistration> {
    const existing = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
    });

    const matchCount = await prisma.match.count({
      where: { tournamentCategoryId: existing.tournamentCategoryId },
    });
    if (matchCount > 0) {
      throw new Error("Cannot withdraw a registration once the bracket has been generated.");
    }

    const registration = await prisma.tournamentRegistration.update({
      where: { id: registrationId },
      data: { status: "WITHDRAWN" },
    });

    if (existing.status === "CONFIRMED") {
      await this.promoteFromWaitlist(existing.tournamentCategoryId);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.registration_withdrawn",
      entityType: "TournamentRegistration",
      entityId: registration.id,
      oldValues: { status: existing.status },
      newValues: { status: registration.status },
    });

    return registration;
  }

  // Owner request (2026-08-05): "add option to delete ... to those who
  // cancelled or typo errors." Deliberately refuses to touch a
  // registration with a real recorded Sale (payment already collected)
  // — that money is real revenue history, and deleting it here would
  // silently falsify past reports. Withdraw (above) is the correct tool
  // for a paid registration that needs to go away from the active list;
  // this is only for a genuine mistake that never had money attached
  // (e.g. a free tournament, or a registration cancelled before
  // payment). Same "no bracket yet" guard as withdraw — the team/
  // player rows this deletes are exclusively this registration's own
  // (registerTeam always creates fresh ones, never reuses/shares across
  // registrations — see that method's own comment), so cascading the
  // delete down to Team/Player/User is safe and doesn't touch anyone
  // else's data.
  async deleteRegistration(registrationId: string, actorUserId: string): Promise<void> {
    const existing = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      include: {
        sale: { select: { id: true } },
        team: {
          select: {
            id: true,
            player1Id: true,
            player2Id: true,
            player1: { select: { userId: true } },
            player2: { select: { userId: true } },
          },
        },
      },
    });

    const matchCount = await prisma.match.count({
      where: { tournamentCategoryId: existing.tournamentCategoryId },
    });
    if (matchCount > 0) {
      throw new Error("Cannot delete a registration once the bracket has been generated.");
    }
    if (existing.sale) {
      throw new Error(
        "This registration has a recorded payment and can't be deleted — withdraw it instead so the payment record stays intact.",
      );
    }

    const userIds = [existing.team.player1.userId, existing.team.player2?.userId].filter(
      (id): id is string => id != null,
    );

    await prisma.$transaction(async (tx) => {
      await tx.tournamentRegistration.delete({ where: { id: registrationId } });
      await tx.team.delete({ where: { id: existing.team.id } });
      await tx.player.deleteMany({
        where: { id: { in: [existing.team.player1Id, existing.team.player2Id].filter((id): id is string => id != null) } },
      });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });

    if (existing.status === "CONFIRMED") {
      await this.promoteFromWaitlist(existing.tournamentCategoryId);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.registration_deleted",
      entityType: "TournamentRegistration",
      entityId: registrationId,
      oldValues: existing,
    });
  }

  // Owner request (2026-08-05): "add option to ... edit, to those who
  // ... typo errors." Corrects only the typed name(s) already on the
  // team — never adds/removes a player2 (singles vs. doubles is a
  // structural change, not a typo fix). Deliberately untouched by the
  // bracket-generated guard delete/withdraw both use: a display-name
  // correction can't break a bracket that already exists, so there's no
  // reason to block it post-bracket.
  async updateRegistrationPlayerNames(
    registrationId: string,
    input: UpdateRegistrationPlayerNamesInput,
    actorUserId: string,
  ): Promise<TournamentRegistration> {
    const existing = await prisma.tournamentRegistration.findUniqueOrThrow({
      where: { id: registrationId },
      include: {
        team: {
          select: {
            player1: { select: { userId: true, user: { select: { name: true } } } },
            player2: { select: { userId: true, user: { select: { name: true } } } },
          },
        },
      },
    });

    if (existing.team.player2 && !input.player2Name?.trim()) {
      throw new Error("This is a doubles team — enter player 2's name too.");
    }
    if (!existing.team.player2 && input.player2Name?.trim()) {
      throw new Error(
        "This is a singles registration — adding a second player isn't a name correction. Withdraw and re-register as doubles instead.",
      );
    }

    const oldNames = {
      player1Name: existing.team.player1.user.name,
      player2Name: existing.team.player2?.user.name ?? null,
    };

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.team.player1.userId },
        data: { name: input.player1Name },
      });
      if (existing.team.player2 && input.player2Name?.trim()) {
        await tx.user.update({
          where: { id: existing.team.player2.userId },
          data: { name: input.player2Name.trim() },
        });
      }
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.registration_names_corrected",
      entityType: "TournamentRegistration",
      entityId: registrationId,
      oldValues: oldNames,
      newValues: { player1Name: input.player1Name, player2Name: input.player2Name ?? null },
    });

    return prisma.tournamentRegistration.findUniqueOrThrow({ where: { id: registrationId } });
  }

  // Owner request (2026-08-11): "create 2 brackets with option of 3 or
  // 4 or equally divide the players for the bracket created. then it
  // will auto create the match" — randomly draws the confirmed field
  // into poolCount groups (dividePoolsEvenly spreads any remainder
  // across pools rather than dumping it in the last one) and writes
  // poolLabel onto each registration. Overwrites any previous pool
  // assignment — calling this again re-draws everyone fresh, same
  // "always re-derive, don't try to diff" shape as re-running
  // generateBracket after resetBracket. generateBracket itself is what
  // actually creates the per-pool matches — this only decides who's in
  // which pool.
  async createPools(
    categoryId: string,
    poolCount: number,
    actorUserId: string,
  ): Promise<{ poolLabel: string; teamIds: string[] }[]> {
    const existingMatchCount = await prisma.match.count({
      where: { tournamentCategoryId: categoryId },
    });
    if (existingMatchCount > 0) {
      throw new Error("Matchups have already been generated for this category — reset them first to redraw pools.");
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: categoryId, status: "CONFIRMED" },
      select: { teamId: true },
    });
    if (registrations.length < 2) {
      throw new Error("At least 2 confirmed teams are required to create pools.");
    }

    const teamIds = registrations.map((registration) => registration.teamId);
    for (let i = teamIds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [teamIds[i], teamIds[j]] = [teamIds[j], teamIds[i]];
    }

    const pools = dividePoolsEvenly(teamIds, poolCount);

    await prisma.$transaction(
      pools.flatMap((pool) =>
        pool.teamIds.map((teamId, index) =>
          prisma.tournamentRegistration.updateMany({
            where: { tournamentCategoryId: categoryId, teamId, status: "CONFIRMED" },
            // index + 1: draw order within THIS pool, after the shuffle
            // above — the display number (bracket-generator.ts's
            // formatTeamPoolNumber combines this with poolLabel, e.g.
            // "1a", "2a").
            data: { poolLabel: pool.poolLabel, poolPosition: index + 1 },
          }),
        ),
      ),
    );

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.pools_created",
      entityType: "TournamentCategory",
      entityId: categoryId,
      newValues: { pools: pools.map((pool) => ({ poolLabel: pool.poolLabel, teamCount: pool.teamIds.length })) },
    });

    return pools;
  }

  // Owner request (2026-08-11): "i want to edit and manually add teams.
  // as what ive said. teams will be drawn by wheel of fortune for
  // fairness" — createPools' random shuffle is a quick-start option,
  // not the only way in. This is the one-team-at-a-time move: staff
  // pick each team's real pool as the external wheel draws it live, or
  // fix a single mis-drawn team without redrawing everyone else the
  // way createPools would. poolLabel: null clears a team back to
  // unassigned (e.g. to undo a wheel result and redraw that one team).
  async setTeamPool(
    categoryId: string,
    teamId: string,
    poolLabel: string | null,
    actorUserId: string,
  ): Promise<void> {
    const existingMatchCount = await prisma.match.count({
      where: { tournamentCategoryId: categoryId },
    });
    if (existingMatchCount > 0) {
      throw new Error("Matchups have already been generated for this category — reset them first to change pools.");
    }

    const registration = await prisma.tournamentRegistration.findFirst({
      where: { tournamentCategoryId: categoryId, teamId, status: "CONFIRMED" },
    });
    if (!registration) {
      throw new Error("That team isn't a confirmed registration in this category.");
    }

    // Appended to the end of the target pool — same "1-indexed position
    // within this pool" meaning createPools writes, just assigned one
    // team at a time instead of by a fresh shuffle. Excludes this
    // registration's own row from the count so re-assigning a team to
    // the pool it's already in doesn't push its own position forward.
    // null when clearing back to unassigned (poolLabel: null).
    const poolPosition =
      poolLabel === null
        ? null
        : (await prisma.tournamentRegistration.count({
            where: {
              tournamentCategoryId: categoryId,
              poolLabel,
              status: "CONFIRMED",
              id: { not: registration.id },
            },
          })) + 1;

    await prisma.tournamentRegistration.update({
      where: { id: registration.id },
      data: { poolLabel, poolPosition },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.team_pool_changed",
      entityType: "TournamentRegistration",
      entityId: registration.id,
      oldValues: { poolLabel: registration.poolLabel, poolPosition: registration.poolPosition },
      newValues: { poolLabel, poolPosition },
    });
  }

  // Owner request (2026-08-13): "can i hva a pool players list. edit it
  // and change it" — real incident: a live tournament's pools had been
  // drawn before poolPosition existed, so every team showed no number at
  // all, and there was no way back in through setTeamPool above, which
  // correctly refuses once matches exist. This is the fix — a pure
  // relabeling correction, deliberately with NO "matches already
  // generated" guard, since it never touches a Match row (Match.poolLabel
  // is denormalized at generateBracket time and stays whatever it was —
  // correcting a team's own pool/position here does not retroactively
  // move any already-created match to a different pool section). Both
  // poolLabel and poolPosition are set explicitly together (or cleared
  // together) — see the schema's own comment for why this doesn't
  // auto-append the way setTeamPool/createPools do.
  async correctTeamPoolAssignment(
    categoryId: string,
    teamId: string,
    poolLabel: string | null,
    poolPosition: number | null,
    actorUserId: string,
  ): Promise<void> {
    if ((poolLabel === null) !== (poolPosition === null)) {
      throw new Error("A pool and a position must be set together, or both cleared.");
    }
    if (poolPosition !== null && (!Number.isInteger(poolPosition) || poolPosition < 1)) {
      throw new Error("Position must be a positive whole number.");
    }

    const registration = await prisma.tournamentRegistration.findFirst({
      where: { tournamentCategoryId: categoryId, teamId, status: "CONFIRMED" },
    });
    if (!registration) {
      throw new Error("That team isn't a confirmed registration in this category.");
    }

    await prisma.tournamentRegistration.update({
      where: { id: registration.id },
      data: { poolLabel, poolPosition },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.pool_assignment_corrected",
      entityType: "TournamentRegistration",
      entityId: registration.id,
      oldValues: { poolLabel: registration.poolLabel, poolPosition: registration.poolPosition },
      newValues: { poolLabel, poolPosition },
    });
  }

  async generateBracket(categoryId: string, actorUserId: string): Promise<void> {
    const category = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: categoryId },
    });

    const existingMatchCount = await prisma.match.count({
      where: { tournamentCategoryId: categoryId },
    });
    if (existingMatchCount > 0) {
      throw new Error("A bracket has already been generated for this category.");
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: { tournamentCategoryId: categoryId, status: "CONFIRMED" },
      orderBy: { registeredAt: "asc" },
      select: { teamId: true, poolLabel: true },
    });

    if (registrations.length < 2) {
      throw new Error("At least 2 confirmed teams are required to generate a bracket.");
    }

    const teamIds = registrations.map((registration) => registration.teamId);

    if (category.format === "ROUND_ROBIN") {
      const pooledCount = registrations.filter((r) => r.poolLabel !== null).length;
      if (pooledCount > 0 && pooledCount < registrations.length) {
        throw new Error(
          "Every confirmed team must be assigned to a pool before generating matchups — re-run Create pools so the new team is included.",
        );
      }

      const matchData: Array<{
        tournamentCategoryId: string;
        round: number;
        poolLabel: string | null;
        team1Id: string;
        team2Id: string;
        status: "SCHEDULED";
      }> = [];

      if (pooledCount > 0) {
        // Owner request (2026-08-11): "create 2 brackets... then it
        // will auto create the match" — one independent round robin
        // per pool (round numbers restart at 1 within each pool, same
        // as the unpooled path below), not one flat round robin across
        // every confirmed team.
        const byPool = new Map<string, string[]>();
        for (const registration of registrations) {
          const label = registration.poolLabel as string;
          const list = byPool.get(label) ?? [];
          list.push(registration.teamId);
          byPool.set(label, list);
        }
        for (const [poolLabel, poolTeamIds] of byPool) {
          for (const pairing of generateRoundRobinPairings(poolTeamIds)) {
            matchData.push({
              tournamentCategoryId: categoryId,
              round: pairing.round,
              poolLabel,
              team1Id: pairing.team1Id,
              team2Id: pairing.team2Id,
              status: "SCHEDULED",
            });
          }
        }
      } else {
        for (const pairing of generateRoundRobinPairings(teamIds)) {
          matchData.push({
            tournamentCategoryId: categoryId,
            round: pairing.round,
            poolLabel: null,
            team1Id: pairing.team1Id,
            team2Id: pairing.team2Id,
            status: "SCHEDULED",
          });
        }
      }

      await prisma.match.createMany({ data: matchData });
    } else if (category.format === "SINGLE_ELIMINATION") {
      const pairings = generateSingleEliminationRound1(teamIds);
      for (let position = 0; position < pairings.length; position += 1) {
        const pairing = pairings[position];
        const isBye = pairing.team2Id === null;

        await prisma.match.create({
          data: {
            tournamentCategoryId: categoryId,
            round: 1,
            bracketPosition: position,
            team1Id: pairing.team1Id,
            team2Id: pairing.team2Id,
            status: isBye ? "COMPLETED" : "SCHEDULED",
            winnerTeamId: isBye ? pairing.team1Id : null,
            completedAt: isBye ? new Date() : null,
          },
        });
      }
    } else {
      throw new Error(`Bracket generation for ${category.format} is not supported in this phase.`);
    }

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.bracket_generated",
      entityType: "TournamentCategory",
      entityId: categoryId,
      newValues: { teamCount: teamIds.length, format: category.format },
    });
  }

  // Owner request (2026-08-11): "the bracketing might be done live via
  // wheel of fortune in the internet so that everybody can see it" — the
  // actual random draw happens externally, on stream, not in this app.
  // This just records whatever pairing that produces, one match at a
  // time — no auto-pairing, no group/pool concept, deliberately. Works
  // alongside generateBracket/resetBracket, not instead of them: a
  // category can mix an auto-generated round robin with extra manually
  // added matches, or be built entirely by hand if generateBracket was
  // never run for it.
  async createManualMatch(
    categoryId: string,
    input: { team1Id: string; team2Id: string; round?: number },
    actorUserId: string,
  ): Promise<Match> {
    if (input.team1Id === input.team2Id) {
      throw new Error("Pick two different teams.");
    }

    const registrations = await prisma.tournamentRegistration.findMany({
      where: {
        tournamentCategoryId: categoryId,
        status: "CONFIRMED",
        teamId: { in: [input.team1Id, input.team2Id] },
      },
      select: { teamId: true },
    });
    const confirmedTeamIds = new Set(registrations.map((r) => r.teamId));
    if (!confirmedTeamIds.has(input.team1Id) || !confirmedTeamIds.has(input.team2Id)) {
      throw new Error("Both teams must be confirmed registrations in this category.");
    }

    const match = await prisma.match.create({
      data: {
        tournamentCategoryId: categoryId,
        round: input.round ?? null,
        team1Id: input.team1Id,
        team2Id: input.team2Id,
        status: "SCHEDULED",
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.match_created_manually",
      entityType: "TournamentCategory",
      entityId: categoryId,
      newValues: { matchId: match.id, team1Id: input.team1Id, team2Id: input.team2Id, round: match.round },
    });

    return match;
  }

  // Owner request (2026-08-11): "can i remove this after all. these are
  // all trials" — undoes generateBracket so a category can be
  // regenerated cleanly (generateBracket itself refuses to run again
  // while any Match rows exist). Real delete, not a status flip — a
  // trial bracket has no revenue or real standings tied to it worth
  // preserving. Score rows cascade-delete with their Match (see
  // Score.match's own onDelete: Cascade). Registrations/teams are left
  // untouched — this only undoes the bracket step, not who's signed up.
  async resetBracket(categoryId: string, actorUserId: string): Promise<void> {
    const { count } = await prisma.match.deleteMany({ where: { tournamentCategoryId: categoryId } });
    if (count === 0) {
      throw new Error("This category has no bracket to reset.");
    }

    await this.writeAuditLog({
      actorUserId,
      action: "tournament.bracket_reset",
      entityType: "TournamentCategory",
      entityId: categoryId,
      oldValues: { matchCount: count },
    });
  }

  private async promoteFromWaitlist(categoryId: string): Promise<void> {
    const nextWaitlisted = await prisma.tournamentRegistration.findFirst({
      where: { tournamentCategoryId: categoryId, status: "WAITLISTED" },
      orderBy: { registeredAt: "asc" },
    });

    if (!nextWaitlisted) {
      return;
    }

    await prisma.tournamentRegistration.update({
      where: { id: nextWaitlisted.id },
      data: { status: "CONFIRMED" },
    });
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const tournamentService = new TournamentService();
