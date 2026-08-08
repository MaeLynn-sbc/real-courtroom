"use server";

import {
  correctSalePaymentMethodInputSchema,
  type CorrectSalePaymentMethodInput,
} from "@/features/sales/schemas/sale.schema";
import { requireEmployee } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { saleService } from "@/services/sales/sale.service";
import { PERMISSIONS } from "@/types/permissions";

export interface SaleActionState {
  error: string | null;
}

// Owner request (2026-08-08): a real, audit-logged correction for when an
// attendant records a Cash payment as GCash (or the reverse) — see
// saleService.correctPaymentMethod's own comment. Same "no anonymous
// adjustments" gating shape as writeOffTabAction (requireEmployee, not
// just requirePermission — this needs a real employeeId, not only a
// permission check).
export async function correctSalePaymentMethodAction(
  input: CorrectSalePaymentMethodInput,
): Promise<SaleActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.ACCOUNTS_CORRECT_SALE_PAYMENT_METHOD,
    "You don't have permission to correct a sale's payment method.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = correctSalePaymentMethodInputSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid request." };
  }

  try {
    await saleService.correctPaymentMethod(
      parsed.data.saleId,
      parsed.data.fromPaymentMethodId,
      parsed.data.toPaymentMethodId,
      parsed.data.reason,
      authz.employeeId,
      authz.userId,
    );
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "correctSalePaymentMethodAction", userId: authz.userId }),
    };
  }
}
