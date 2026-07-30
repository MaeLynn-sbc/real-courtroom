"use server";

import { revalidatePath } from "next/cache";

import {
  recordOpenPlayRegistrationPaymentProofReferenceSchema,
  rejectOpenPlayRegistrationPaymentProofSchema,
  type RecordOpenPlayRegistrationPaymentProofReferenceActionInput,
  type RejectOpenPlayRegistrationPaymentProofActionInput,
} from "@/features/open-play-capacity/schemas/open-play-registration-payment-proof.schema";
import { requireEmployee, requireEmployeeWithOpenShift } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";
import { PERMISSIONS } from "@/types/permissions";

export interface OpenPlayRegistrationPaymentProofActionState {
  error: string | null;
  alreadyResolved?: boolean;
}

// Mirrors actions/booking-payment-proof.actions.ts's own
// resolveGcashPaymentMethodId exactly — every real verification here is,
// by definition, a GCash payment (the public form only ever collects
// GCash proof), so staff don't pick a payment method the way the
// walk-in desk flow lets them.
async function resolveGcashPaymentMethodId(): Promise<string> {
  const method = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  return method.id;
}

export async function approveOpenPlayRegistrationPaymentProofAction(
  proofId: string,
): Promise<OpenPlayRegistrationPaymentProofActionState> {
  const authz = await requireEmployeeWithOpenShift(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "Start a shift before verifying a payment.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const paymentMethodId = await resolveGcashPaymentMethodId();
    const result = await openPlayRegistrationPaymentProofService.approveOpenPlayRegistrationPaymentProof(proofId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId,
      actorUserId: authz.userId,
    });

    revalidatePath("/dashboard/admin/open-play-capacity");
    return { error: null, alreadyResolved: result.alreadyResolved };
  } catch (error) {
    return { error: toActionError(error, { action: "approveOpenPlayRegistrationPaymentProofAction", userId: authz.userId }) };
  }
}

export async function recordOpenPlayRegistrationPaymentProofReferenceAction(
  input: RecordOpenPlayRegistrationPaymentProofReferenceActionInput,
): Promise<OpenPlayRegistrationPaymentProofActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to verify open-play payments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = recordOpenPlayRegistrationPaymentProofReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid reference." };
  }

  try {
    await openPlayRegistrationPaymentProofService.recordGcashReference(
      parsed.data.proofId,
      parsed.data.gcashReference,
      authz.userId,
    );
    revalidatePath("/dashboard/admin/open-play-capacity");
    return { error: null };
  } catch (error) {
    return {
      error: toActionError(error, { action: "recordOpenPlayRegistrationPaymentProofReferenceAction", userId: authz.userId }),
    };
  }
}

export async function rejectOpenPlayRegistrationPaymentProofAction(
  input: RejectOpenPlayRegistrationPaymentProofActionInput,
): Promise<OpenPlayRegistrationPaymentProofActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.OPEN_PLAY_MANAGE,
    "You don't have permission to verify open-play payments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = rejectOpenPlayRegistrationPaymentProofSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rejection." };
  }

  try {
    const result = await openPlayRegistrationPaymentProofService.rejectOpenPlayRegistrationPaymentProof(
      parsed.data.proofId,
      parsed.data.reason,
      { employeeId: authz.employeeId, actorUserId: authz.userId },
    );

    revalidatePath("/dashboard/admin/open-play-capacity");
    return { error: null, alreadyResolved: result.alreadyResolved };
  } catch (error) {
    return { error: toActionError(error, { action: "rejectOpenPlayRegistrationPaymentProofAction", userId: authz.userId }) };
  }
}
