"use server";

import { revalidatePath } from "next/cache";

import {
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  type CreatePaymentMethodInput,
  type UpdatePaymentMethodInput,
} from "@/features/payment-methods/schemas/payment-method.schema";
import { requirePermission } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { saleService } from "@/services/sales/sale.service";
import { PERMISSIONS } from "@/types/permissions";

export interface PaymentMethodActionState {
  error: string | null;
}

function requireSystemAdmin() {
  return requirePermission(
    PERMISSIONS.SYSTEM_ADMIN,
    "You don't have permission to manage payment methods.",
  );
}

export async function createPaymentMethodAction(
  input: CreatePaymentMethodInput,
): Promise<PaymentMethodActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = createPaymentMethodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid payment method details." };
  }

  try {
    await saleService.createPaymentMethod(parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/payment-methods");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "createPaymentMethodAction", userId: authz.userId }),
    };
  }
}

export async function updatePaymentMethodAction(
  paymentMethodId: string,
  input: UpdatePaymentMethodInput,
): Promise<PaymentMethodActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = updatePaymentMethodSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid payment method details." };
  }

  try {
    await saleService.updatePaymentMethod(paymentMethodId, parsed.data, authz.userId);
    revalidatePath("/dashboard/admin/payment-methods");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "updatePaymentMethodAction", userId: authz.userId }),
    };
  }
}

export async function setPaymentMethodActiveAction(
  paymentMethodId: string,
  isActive: boolean,
): Promise<PaymentMethodActionState> {
  const authz = await requireSystemAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await saleService.setPaymentMethodActive(paymentMethodId, isActive, authz.userId);
    revalidatePath("/dashboard/admin/payment-methods");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "setPaymentMethodActiveAction", userId: authz.userId }),
    };
  }
}
