import type { PaymentMethod, Prisma, Sale } from "@/lib/generated/prisma/client";
import type { SaleCategory, SaleSource } from "@/lib/generated/prisma/enums";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import type { DateRange } from "@/services/analytics/date-range";
import { formatSaleNumber } from "@/services/sales/sale-reference";

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

export interface CreateSaleInput {
  category: SaleCategory;
  source?: SaleSource;
  amountCents: number;
  paymentMethodId: string;
  employeeId: string;
  shiftId: string;
  playerId?: string | null;
  bookingId?: string;
  membershipId?: string;
  equipmentRentalId?: string;
  lockerRentalId?: string;
  tournamentRegistrationId?: string;
  productId?: string;
  playerTabId?: string;
  openPlayNightRegistrationId?: string;
  description?: string;
  notes?: string;
}

export interface UpsertPaymentMethodInput {
  key: string;
  label: string;
  sortOrder?: number;
}

export interface SalesSummaryCategoryBreakdown {
  category: SaleCategory;
  amountCents: number;
  count: number;
}

export interface SalesSummaryPaymentMethodBreakdown {
  paymentMethodId: string;
  label: string;
  amountCents: number;
  count: number;
}

export interface SalesSummaryEmployeeBreakdown {
  employeeId: string;
  employeeNumber: string;
  name: string;
  amountCents: number;
  count: number;
}

export interface SalesSummary {
  totalAmountCents: number;
  transactionCount: number;
  averageAmountCents: number;
  byCategory: SalesSummaryCategoryBreakdown[];
  byPaymentMethod: SalesSummaryPaymentMethodBreakdown[];
  byEmployee: SalesSummaryEmployeeBreakdown[];
}

export interface ShiftSalesSummary {
  totalAmountCents: number;
  transactionCount: number;
}

// The single place responsible for creating Sale rows — every revenue
// workflow (booking/membership/equipment rental/locker rental/tournament
// registration) calls createSale, never prisma.sale.create directly.
export class SaleService {
  // Called from inside each revenue workflow's own transaction (pass that
  // transaction's `tx` as `client`) so the Sale and its source row commit
  // atomically — never one without the other. `saleNumber` comes from the
  // shared atomic counter (lib/reference-counter.ts), so no retry-on-
  // collision handling is needed here — it can't collide.
  async createSale(
    input: CreateSaleInput,
    client: Prisma.TransactionClient | typeof prisma = prisma,
  ): Promise<Sale> {
    const now = new Date();
    const sequence = await nextSequence(dailyScope("SALE", now), client);
    const saleNumber = formatSaleNumber(now, sequence);

    return client.sale.create({
      data: {
        saleNumber,
        category: input.category,
        source: input.source ?? "RECEPTION",
        amountCents: input.amountCents,
        paymentMethodId: input.paymentMethodId,
        employeeId: input.employeeId,
        shiftId: input.shiftId,
        playerId: input.playerId ?? undefined,
        bookingId: input.bookingId,
        membershipId: input.membershipId,
        equipmentRentalId: input.equipmentRentalId,
        lockerRentalId: input.lockerRentalId,
        tournamentRegistrationId: input.tournamentRegistrationId,
        productId: input.productId,
        playerTabId: input.playerTabId,
        openPlayNightRegistrationId: input.openPlayNightRegistrationId,
        description: input.description,
        notes: input.notes,
      },
    });
  }

  // Callers write the Sale itself inside their own transaction (above), then
  // call this afterward on the default client, once that transaction has
  // committed — same "audit log after commit" convention every other
  // service in this app follows.
  async logSaleCreated(sale: Sale, actorUserId: string): Promise<void> {
    await this.writeAuditLog({
      actorUserId,
      action: "sale.created",
      entityType: "Sale",
      entityId: sale.id,
      newValues: sale,
    });
  }

  async listSalesForPlayer(playerId: string): Promise<Sale[]> {
    return prisma.sale.findMany({ where: { playerId }, orderBy: { createdAt: "desc" } });
  }

  // Powers the Operations Workspace's Today's Revenue panel and the
  // Sale-backed report types — one grouped-query pass, no per-row loop.
  // VOID sales are excluded (COMPLETED only) since a voided sale isn't
  // revenue.
  async getSalesSummary(range: DateRange): Promise<SalesSummary> {
    const where: Prisma.SaleWhereInput = {
      createdAt: { gte: range.from, lte: range.to },
      status: "COMPLETED",
    };

    const [totals, byCategory, byPaymentMethod, byEmployee, paymentMethods, employees] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { amountCents: true }, _count: true }),
      prisma.sale.groupBy({ by: ["category"], where, _sum: { amountCents: true }, _count: true }),
      prisma.sale.groupBy({ by: ["paymentMethodId"], where, _sum: { amountCents: true }, _count: true }),
      prisma.sale.groupBy({ by: ["employeeId"], where, _sum: { amountCents: true }, _count: true }),
      prisma.paymentMethod.findMany(),
      prisma.employee.findMany(),
    ]);

    const totalAmountCents = totals._sum.amountCents ?? 0;
    const transactionCount = totals._count;
    const averageAmountCents = transactionCount > 0 ? Math.round(totalAmountCents / transactionCount) : 0;

    const paymentMethodById = new Map(paymentMethods.map((method) => [method.id, method]));
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

    return {
      totalAmountCents,
      transactionCount,
      averageAmountCents,
      byCategory: byCategory.map((row) => ({
        category: row.category,
        amountCents: row._sum.amountCents ?? 0,
        count: row._count,
      })),
      byPaymentMethod: byPaymentMethod.map((row) => ({
        paymentMethodId: row.paymentMethodId,
        label: paymentMethodById.get(row.paymentMethodId)?.label ?? "Unknown",
        amountCents: row._sum.amountCents ?? 0,
        count: row._count,
      })),
      byEmployee: byEmployee.map((row) => {
        const employee = employeeById.get(row.employeeId);
        return {
          employeeId: row.employeeId,
          employeeNumber: employee?.employeeNumber ?? "Unknown",
          name: employee ? `${employee.firstName} ${employee.lastName}` : "Unknown",
          amountCents: row._sum.amountCents ?? 0,
          count: row._count,
        };
      }),
    };
  }

  // Powers the Operations Workspace's My Shift panel — how much the
  // signed-in employee has personally rung up so far during their
  // currently open shift.
  async getSalesForShift(shiftId: string): Promise<ShiftSalesSummary> {
    const result = await prisma.sale.aggregate({
      where: { shiftId, status: "COMPLETED" },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      totalAmountCents: result._sum.amountCents ?? 0,
      transactionCount: result._count,
    };
  }

  // Gate 1 (shift cash reconciliation): the cash-only counterpart to
  // getSalesForShift above — everything that method sums across every
  // payment method, this narrows to just PaymentMethod.key = "CASH".
  // Powers "expected cash" on the close-shift screen: openingCashCents +
  // this = what the drawer should hold before staff count it.
  async getCashSalesForShift(shiftId: string): Promise<ShiftSalesSummary> {
    const cashMethod = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "CASH" } });
    const result = await prisma.sale.aggregate({
      where: { shiftId, status: "COMPLETED", paymentMethodId: cashMethod.id },
      _sum: { amountCents: true },
      _count: true,
    });

    return {
      totalAmountCents: result._sum.amountCents ?? 0,
      transactionCount: result._count,
    };
  }

  async listPaymentMethods(includeInactive = false): Promise<PaymentMethod[]> {
    return prisma.paymentMethod.findMany({
      where: includeInactive ? undefined : { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    });
  }

  async createPaymentMethod(input: UpsertPaymentMethodInput, actorUserId: string): Promise<PaymentMethod> {
    const method = await prisma.paymentMethod.create({
      data: { key: input.key, label: input.label, sortOrder: input.sortOrder ?? 0 },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "payment_method.created",
      entityType: "PaymentMethod",
      entityId: method.id,
      newValues: method,
    });

    return method;
  }

  async updatePaymentMethod(
    id: string,
    input: { label?: string; sortOrder?: number },
    actorUserId: string,
  ): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUniqueOrThrow({ where: { id } });

    const method = await prisma.paymentMethod.update({
      where: { id },
      data: { label: input.label, sortOrder: input.sortOrder },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "payment_method.updated",
      entityType: "PaymentMethod",
      entityId: method.id,
      oldValues: existing,
      newValues: method,
    });

    return method;
  }

  async setPaymentMethodActive(id: string, isActive: boolean, actorUserId: string): Promise<PaymentMethod> {
    const existing = await prisma.paymentMethod.findUniqueOrThrow({ where: { id } });

    const method = await prisma.paymentMethod.update({ where: { id }, data: { isActive } });

    await this.writeAuditLog({
      actorUserId,
      action: isActive ? "payment_method.enabled" : "payment_method.disabled",
      entityType: "PaymentMethod",
      entityId: method.id,
      oldValues: { isActive: existing.isActive },
      newValues: { isActive: method.isActive },
    });

    return method;
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

export const saleService = new SaleService();
