"use server";

import { revalidatePath } from "next/cache";

import {
  createProductSchema,
  reorderProductsSchema,
  sellCustomItemSchema,
  sellProductSchema,
  updateProductSchema,
  type CreateProductInput,
  type ReorderProductsInput,
  type SellCustomItemInput,
  type SellProductInput,
  type UpdateProductInput,
} from "@/features/products/schemas/product.schema";
import { requireEmployeeWithOpenShift, requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { productService } from "@/services/products/product.service";
import { saleService } from "@/services/sales/sale.service";
import { PERMISSIONS } from "@/types/permissions";

export interface ProductActionState {
  error: string | null;
}

export interface CreateProductActionState extends ProductActionState {
  productId?: string;
}

function revalidateProducts(): void {
  revalidatePath("/dashboard/admin/products");
  revalidatePath("/dashboard/products");
}

export async function createProductAction(
  input: CreateProductInput,
): Promise<CreateProductActionState> {
  const authz = await requireSystemAdmin("You don't have permission to manage products.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createProductSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  }

  try {
    const product = await productService.createProduct(parsed.data, authz.userId);
    revalidateProducts();
    return { error: null, productId: product.id };
  } catch (error) {
    return { error: toActionError(error, { action: "createProductAction", userId: authz.userId }) };
  }
}

export async function updateProductAction(
  productId: string,
  input: UpdateProductInput,
): Promise<ProductActionState> {
  const authz = await requireSystemAdmin("You don't have permission to manage products.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updateProductSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid product details." };
  }

  try {
    await productService.updateProduct(productId, parsed.data, authz.userId);
    revalidateProducts();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "updateProductAction", userId: authz.userId }) };
  }
}

export async function reorderProductsAction(
  input: ReorderProductsInput,
): Promise<ProductActionState> {
  const authz = await requireSystemAdmin("You don't have permission to manage products.");
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = reorderProductsSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid order." };
  }

  try {
    await productService.reorderProducts(parsed.data.orderedIds, authz.userId);
    revalidateProducts();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "reorderProductsAction", userId: authz.userId }),
    };
  }
}

export async function sellProductAction(input: SellProductInput): Promise<ProductActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.EQUIPMENT_MANAGE,
    "You don't have permission to sell products.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = sellProductSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid sale details." };
  }

  try {
    await productService.sellProduct(parsed.data, authz.userId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId: parsed.data.paymentMethodId,
    });
    revalidateProducts();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "sellProductAction", userId: authz.userId }) };
  }
}

// Occasional consignment items (shirts, grips, whatever isn't worth a
// permanent catalog entry) — same EQUIPMENT_MANAGE gate as selling a
// real catalog product, since this is the same "someone at the Shop
// page rang up a sale" action, just with a typed name/price instead of
// a picked Product. category OTHER, no productId, no stock touched —
// there's no Product row to decrement.
export async function sellCustomItemAction(
  input: SellCustomItemInput,
): Promise<ProductActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.EQUIPMENT_MANAGE,
    "You don't have permission to sell products.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = sellCustomItemSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid sale details." };
  }

  try {
    const { description, unitPriceCents, quantity, paymentMethodId, playerId } = parsed.data;
    const sale = await saleService.createSale({
      category: "OTHER",
      amountCents: unitPriceCents * quantity,
      paymentMethodId,
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      playerId,
      description: quantity > 1 ? `${description} x${quantity}` : description,
    });
    await saleService.logSaleCreated(sale, authz.userId);
    revalidateProducts();
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "sellCustomItemAction", userId: authz.userId }),
    };
  }
}
