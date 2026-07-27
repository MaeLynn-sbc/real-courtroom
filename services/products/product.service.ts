import type { CreateProductInput, SellProductInput, UpdateProductInput } from "@/features/products/schemas/product.schema";
import type { Prisma, Sale } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { saleService } from "@/services/sales/sale.service";

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

// v1.1: a simple retail catalog (SaleCategory.PRODUCT) — deliberately no
// stock/quantity tracking, unlike Equipment. Selling a product goes
// through saleService.createSale/logSaleCreated, the same two-step call
// every other sale-producing service makes, so product sales show up in
// revenue reports and player/shift history automatically.
export interface SellProductSaleContext {
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

export class ProductService {
  async listProducts() {
    return prisma.product.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  }

  async listActiveProducts() {
    return prisma.product.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  // Mirrors equipmentService.getRentalRateCentsByKey's shape — a price
  // lookup for a line-item charge, not a full product fetch. Returns
  // null (not a thrown error) for a missing or inactive product, same
  // "let the caller decide how to surface it" contract as that method.
  async getActiveProductPriceCents(productId: string): Promise<{ name: string; priceCents: number } | null> {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.active) {
      return null;
    }
    return { name: product.name, priceCents: product.priceCents };
  }

  async createProduct(input: CreateProductInput, actorUserId: string) {
    const maxSortOrder = await prisma.product.aggregate({ _max: { sortOrder: true } });
    const product = await prisma.product.create({
      data: {
        name: input.name,
        priceCents: input.priceCents,
        sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "product.created",
      entityType: "Product",
      entityId: product.id,
      newValues: product,
    });

    return product;
  }

  async updateProduct(productId: string, input: UpdateProductInput, actorUserId: string) {
    const existing = await prisma.product.findUniqueOrThrow({ where: { id: productId } });

    const product = await prisma.product.update({
      where: { id: productId },
      data: {
        name: input.name,
        priceCents: input.priceCents,
        active: input.active,
      },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "product.updated",
      entityType: "Product",
      entityId: product.id,
      oldValues: existing,
      newValues: product,
    });

    return product;
  }

  // Bulk-rewrites sortOrder to match the given order — backs the admin
  // catalog's drag-to-reorder.
  async reorderProducts(orderedIds: string[], actorUserId: string): Promise<void> {
    await prisma.$transaction(
      orderedIds.map((id, index) => prisma.product.update({ where: { id }, data: { sortOrder: index } })),
    );

    await this.writeAuditLog({
      actorUserId,
      action: "product.reordered",
      entityType: "Product",
      entityId: orderedIds[0] ?? "unknown",
      newValues: { orderedIds },
    });
  }

  async sellProduct(
    input: SellProductInput,
    actorUserId: string,
    saleContext: SellProductSaleContext,
  ): Promise<Sale> {
    const product = await prisma.product.findUniqueOrThrow({ where: { id: input.productId } });
    if (!product.active) {
      throw new Error("This product is not currently available for sale.");
    }

    const quantity = input.quantity ?? 1;
    const sale = await saleService.createSale({
      category: "PRODUCT",
      amountCents: product.priceCents * quantity,
      paymentMethodId: saleContext.paymentMethodId,
      employeeId: saleContext.employeeId,
      shiftId: saleContext.shiftId,
      playerId: input.playerId,
      productId: product.id,
      description: quantity > 1 ? `${product.name} x${quantity}` : product.name,
    });

    await saleService.logSaleCreated(sale, actorUserId);

    return sale;
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

export const productService = new ProductService();
