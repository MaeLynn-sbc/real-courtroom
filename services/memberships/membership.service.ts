import type {
  ChangePlanInput,
  CreatePlanInput,
  EnrollMembershipInput,
  UpdatePlanInput,
} from "@/features/memberships/schemas/membership.schema";
import type { Membership, MembershipPlan, Prisma } from "@/lib/generated/prisma/client";
import type { MembershipHistoryEventType, MembershipStatus } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { formatMembershipReference } from "@/services/memberships/membership-reference";
import { canTransitionMembershipStatus } from "@/services/memberships/membership-status";
import { calculateRenewalEndDate } from "@/services/memberships/renewal-calculator";
import { saleService } from "@/services/sales/sale.service";

// v1.1 Sub-phase 2: every enrollment is created by a signed-in Employee with
// a currently open Shift, and pays through one of the configured
// PaymentMethod rows — enrollMembershipAction resolves both before calling in.
export interface EnrollMembershipSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
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

interface ListMembershipsFilters {
  status?: MembershipStatus;
  playerId?: string;
}

export class MembershipService {
  async listPlans(includeInactive = false): Promise<MembershipPlan[]> {
    return prisma.membershipPlan.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: { priceCents: "asc" },
    });
  }

  async getPlanById(planId: string): Promise<MembershipPlan | null> {
    return prisma.membershipPlan.findUnique({ where: { id: planId } });
  }

  async createPlan(input: CreatePlanInput, actorUserId: string): Promise<MembershipPlan> {
    const plan = await prisma.membershipPlan.create({
      data: {
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        billingPeriod: input.billingPeriod,
        discountPercent: input.discountPercent,
        priorityBooking: input.priorityBooking ?? false,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "membership_plan.created",
      entityType: "MembershipPlan",
      entityId: plan.id,
      newValues: plan,
    });

    return plan;
  }

  async updatePlan(planId: string, input: UpdatePlanInput, actorUserId: string): Promise<MembershipPlan> {
    const existing = await prisma.membershipPlan.findUniqueOrThrow({ where: { id: planId } });

    const plan = await prisma.membershipPlan.update({
      where: { id: planId },
      data: {
        name: input.name,
        description: input.description,
        priceCents: input.priceCents,
        billingPeriod: input.billingPeriod,
        discountPercent: input.discountPercent,
        priorityBooking: input.priorityBooking,
        isActive: input.isActive,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "membership_plan.updated",
      entityType: "MembershipPlan",
      entityId: plan.id,
      oldValues: existing,
      newValues: plan,
    });

    return plan;
  }

  async listMemberships(filters?: ListMembershipsFilters) {
    await this.reconcileExpiredMemberships();

    return prisma.membership.findMany({
      where: { status: filters?.status, playerId: filters?.playerId },
      include: {
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
        membershipPlan: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async getMembershipById(membershipId: string) {
    await this.reconcileExpiredMemberships();

    return prisma.membership.findUnique({
      where: { id: membershipId },
      include: {
        player: { include: { user: { select: { id: true, name: true, email: true } } } },
        membershipPlan: true,
        history: {
          orderBy: { createdAt: "desc" },
          include: { membershipPlan: true, changedBy: { select: { id: true, name: true } } },
        },
      },
    });
  }

  async getMembershipHistory(membershipId: string) {
    return prisma.membershipHistory.findMany({
      where: { membershipId },
      orderBy: { createdAt: "desc" },
      include: { membershipPlan: true, changedBy: { select: { id: true, name: true } } },
    });
  }

  // Enrollment goes straight to ACTIVE — no PENDING approval step, same
  // staff-driven precedent as every prior phase's registration flow.
  // v1.1 Sub-phase 2: wrapped in a transaction (previously two separate
  // un-transacted writes) so the Membership row and its Sale are always
  // created atomically — never one without the other. v1.1 maintenance:
  // membershipReference now comes from the shared atomic counter
  // (lib/reference-counter.ts), generated inside this same transaction —
  // it can no longer collide, so the retry loop this used to need solely
  // for that is gone.
  async enrollPlayer(
    playerId: string,
    input: EnrollMembershipInput,
    actorUserId: string,
    saleContext: EnrollMembershipSaleContext,
  ): Promise<Membership> {
    const plan = await prisma.membershipPlan.findUniqueOrThrow({
      where: { id: input.membershipPlanId },
    });
    const endDate = calculateRenewalEndDate(input.startDate, plan.billingPeriod, input.startDate);

    const { membership, sale } = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const sequence = await nextSequence(dailyScope("MEMBERSHIP", now), tx);
      const membershipReference = formatMembershipReference(now, sequence);

      const created = await tx.membership.create({
        data: {
          membershipReference,
          playerId,
          membershipPlanId: plan.id,
          status: "ACTIVE",
          startDate: input.startDate,
          endDate,
          autoRenew: input.autoRenew ?? false,
        },
      });

      const createdSale = await saleService.createSale(
        {
          category: "MEMBERSHIP",
          amountCents: plan.priceCents,
          paymentMethodId: saleContext.paymentMethodId,
          employeeId: saleContext.employeeId,
          shiftId: saleContext.shiftId,
          playerId,
          membershipId: created.id,
        },
        tx,
      );

      return { membership: created, sale: createdSale };
    });

    await this.writeHistory(membership.id, "ENROLLED", plan.id, null, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "membership.enrolled",
      entityType: "Membership",
      entityId: membership.id,
      newValues: membership,
    });
    await saleService.logSaleCreated(sale, actorUserId);

    return membership;
  }

  async renewMembership(membershipId: string, actorUserId: string): Promise<Membership> {
    const existing = await prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { membershipPlan: true },
    });

    if (existing.status === "CANCELLED") {
      throw new Error("Reactivate a cancelled or suspended membership before renewing it.");
    }

    const newEndDate = calculateRenewalEndDate(existing.endDate, existing.membershipPlan.billingPeriod);

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { endDate: newEndDate, status: "ACTIVE" },
    });

    await this.writeHistory(membership.id, "RENEWED", existing.membershipPlanId, null, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "membership.renewed",
      entityType: "Membership",
      entityId: membership.id,
      newValues: { endDate: membership.endDate },
    });

    return membership;
  }

  async changePlan(membershipId: string, input: ChangePlanInput, actorUserId: string): Promise<Membership> {
    const existing = await prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: { membershipPlan: true },
    });
    const newPlan = await prisma.membershipPlan.findUniqueOrThrow({
      where: { id: input.membershipPlanId },
    });

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { membershipPlanId: newPlan.id },
    });

    const eventType: MembershipHistoryEventType =
      newPlan.priceCents > existing.membershipPlan.priceCents ? "UPGRADED" : "DOWNGRADED";

    await this.writeHistory(
      membership.id,
      eventType,
      newPlan.id,
      `From ${existing.membershipPlan.name} to ${newPlan.name}`,
      actorUserId,
    );
    await this.writeAuditLog({
      actorUserId,
      action: "membership.plan_changed",
      entityType: "Membership",
      entityId: membership.id,
      oldValues: { membershipPlanId: existing.membershipPlanId },
      newValues: { membershipPlanId: membership.membershipPlanId },
    });

    return membership;
  }

  async suspendMembership(
    membershipId: string,
    note: string | undefined,
    actorUserId: string,
  ): Promise<Membership> {
    const existing = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });

    if (!canTransitionMembershipStatus(existing.status, "CANCELLED")) {
      throw new Error(`Cannot suspend a membership that is currently ${existing.status}.`);
    }

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { status: "CANCELLED" },
    });

    await this.writeHistory(membership.id, "SUSPENDED", existing.membershipPlanId, note ?? null, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "membership.suspended",
      entityType: "Membership",
      entityId: membership.id,
      oldValues: { status: existing.status },
      newValues: { status: membership.status },
    });

    return membership;
  }

  async reactivateMembership(membershipId: string, actorUserId: string): Promise<Membership> {
    const existing = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });

    if (!canTransitionMembershipStatus(existing.status, "ACTIVE")) {
      throw new Error(`Cannot reactivate a membership that is currently ${existing.status}.`);
    }

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { status: "ACTIVE" },
    });

    await this.writeHistory(membership.id, "REACTIVATED", existing.membershipPlanId, null, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "membership.reactivated",
      entityType: "Membership",
      entityId: membership.id,
      oldValues: { status: existing.status },
      newValues: { status: membership.status },
    });

    return membership;
  }

  async cancelMembership(
    membershipId: string,
    note: string | undefined,
    actorUserId: string,
  ): Promise<Membership> {
    const existing = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });

    if (!canTransitionMembershipStatus(existing.status, "CANCELLED")) {
      throw new Error(`Cannot cancel a membership that is currently ${existing.status}.`);
    }

    const membership = await prisma.membership.update({
      where: { id: membershipId },
      data: { status: "CANCELLED" },
    });

    await this.writeHistory(membership.id, "CANCELLED", existing.membershipPlanId, note ?? null, actorUserId);
    await this.writeAuditLog({
      actorUserId,
      action: "membership.cancelled",
      entityType: "Membership",
      entityId: membership.id,
      oldValues: { status: existing.status },
      newValues: { status: membership.status },
    });

    return membership;
  }

  // Called at the top of every list/detail read rather than via a
  // background job — this app has no cron/queue infrastructure. Flips any
  // ACTIVE membership past its endDate to EXPIRED and logs it, so expired
  // memberships are always shown correctly without a scheduler.
  // Phase 10: bulk, not per-row — was 2 queries (update + history create)
  // per expiring membership; now 3 queries total regardless of how many
  // expired, matching the pattern equipmentRentalService
  // .reconcileOverdueRentals / lockerRentalService.reconcileExpiredRentals
  // already used. Still no AuditLog write, same reasoning as before: this
  // transition isn't actor-driven.
  async reconcileExpiredMemberships(): Promise<void> {
    const now = new Date();

    const expiring = await prisma.membership.findMany({
      where: { status: "ACTIVE", endDate: { lt: now } },
      select: { id: true, membershipPlanId: true },
    });

    if (expiring.length === 0) {
      return;
    }

    await prisma.membership.updateMany({
      where: { id: { in: expiring.map((membership) => membership.id) } },
      data: { status: "EXPIRED" },
    });

    await prisma.membershipHistory.createMany({
      data: expiring.map((membership) => ({
        membershipId: membership.id,
        eventType: "EXPIRED" as const,
        membershipPlanId: membership.membershipPlanId,
        note: null,
        changedById: null,
      })),
    });
  }

  private async writeHistory(
    membershipId: string,
    eventType: MembershipHistoryEventType,
    membershipPlanId: string | null,
    note: string | null,
    changedById: string | null,
  ): Promise<void> {
    await prisma.membershipHistory.create({
      data: { membershipId, eventType, membershipPlanId, note, changedById },
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

export const membershipService = new MembershipService();
