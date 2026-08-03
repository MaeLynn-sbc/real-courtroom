import type {
  CreateCategoryInput,
  CreateTournamentInput,
  RegisterTeamInput,
} from "@/features/tournaments/schemas/tournament.schema";
import type {
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
  generateRoundRobinPairings,
  generateSingleEliminationRound1,
} from "@/services/tournaments/bracket-generator";
import { canTransitionTournamentStatus } from "@/services/tournaments/tournament-status";
import { getUploadService } from "@/services/upload/upload-service.factory";

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

// A registration still holding a real slot — the same set the category
// page's own player dropdowns are filtered by (see registration-form's
// caller), so a player already on an active team here can never be
// offered a second team, and registerTeam rejects it server-side too if
// one somehow slips through (a second tab, a stale page).
const ACTIVE_REGISTRATION_STATUSES = ["PENDING", "CONFIRMED", "WAITLISTED"] as const;

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
  async registerTeam(
    categoryId: string,
    input: RegisterTeamInput,
    actorUserId: string,
    saleContext: RegisterTeamSaleContext,
    receipt?: RegisterTeamReceiptInput,
  ): Promise<TournamentRegistration> {
    const category = await prisma.tournamentCategory.findUniqueOrThrow({
      where: { id: categoryId },
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
        const activeRegistrations = await tx.tournamentRegistration.findMany({
          where: { tournamentCategoryId: categoryId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } },
          include: { team: { select: { player1Id: true, player2Id: true } } },
        });
        const registeredPlayerIds = new Set<string>();
        for (const existing of activeRegistrations) {
          registeredPlayerIds.add(existing.team.player1Id);
          if (existing.team.player2Id) {
            registeredPlayerIds.add(existing.team.player2Id);
          }
        }
        if (registeredPlayerIds.has(input.player1Id) || (input.player2Id && registeredPlayerIds.has(input.player2Id))) {
          throw new Error("A selected player is already registered in this category.");
        }

        const team = await tx.team.create({
          data: { player1Id: input.player1Id, player2Id: input.player2Id },
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

        const createdSale = await saleService.createSale(
          {
            category: "TOURNAMENT_REGISTRATION",
            amountCents: category.feeCents,
            paymentMethodId: saleContext.paymentMethodId,
            employeeId: saleContext.employeeId,
            shiftId: saleContext.shiftId,
            playerId: input.player1Id,
            tournamentRegistrationId: createdRegistration.id,
          },
          tx,
        );

        return { registration: createdRegistration, sale: createdSale };
      });

      await this.writeAuditLog({
        actorUserId,
        action: "tournament.team_registered",
        entityType: "TournamentRegistration",
        entityId: registration.id,
        newValues: registration,
      });
      await saleService.logSaleCreated(sale, actorUserId);

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
      select: { teamId: true },
    });

    if (registrations.length < 2) {
      throw new Error("At least 2 confirmed teams are required to generate a bracket.");
    }

    const teamIds = registrations.map((registration) => registration.teamId);

    if (category.format === "ROUND_ROBIN") {
      const pairings = generateRoundRobinPairings(teamIds);
      await prisma.match.createMany({
        data: pairings.map((pairing) => ({
          tournamentCategoryId: categoryId,
          round: pairing.round,
          team1Id: pairing.team1Id,
          team2Id: pairing.team2Id,
          status: "SCHEDULED",
        })),
      });
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
