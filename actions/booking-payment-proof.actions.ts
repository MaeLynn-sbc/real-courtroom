"use server";

import { revalidatePath } from "next/cache";

import {
  recordBookingPaymentProofReferenceSchema,
  rejectBookingPaymentProofSchema,
  type RecordBookingPaymentProofReferenceActionInput,
  type RejectBookingPaymentProofActionInput,
} from "@/features/bookings/schemas/booking-payment-proof.schema";
import { requireEmployee, requireEmployeeForPaymentApproval } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";
import { PERMISSIONS } from "@/types/permissions";

export interface BookingPaymentProofActionState {
  error: string | null;
  alreadyResolved?: boolean;
}

// Every real GCash verification is, by definition, a GCash payment —
// staff don't pick a payment method here the way the pay-at-venue flow
// lets them, since picking the wrong one would misrecord a payment that
// was already verified as GCash. Resolved server-side, same shape as
// services/booking/website-identity.ts resolving its own well-known
// PaymentMethod by key.
async function resolveGcashPaymentMethodId(): Promise<string> {
  const method = await prisma.paymentMethod.findUniqueOrThrow({ where: { key: "GCASH" } });
  return method.id;
}

export async function approveBookingPaymentProofAction(
  proofId: string,
  overrideReason?: string,
  duplicateOverrideReason?: string,
): Promise<BookingPaymentProofActionState> {
  const authz = await requireEmployeeForPaymentApproval(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to verify booking payments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const paymentMethodId = await resolveGcashPaymentMethodId();
    const result = await bookingPaymentProofService.approveBookingPaymentProof(proofId, {
      employeeId: authz.employeeId,
      shiftId: authz.shiftId,
      paymentMethodId,
      actorUserId: authz.userId,
      overrideReason,
      duplicateOverrideReason,
    });

    revalidatePath("/dashboard/bookings");
    return { error: null, alreadyResolved: result.alreadyResolved };
  } catch (error) {
    return { error: toActionError(error, { action: "approveBookingPaymentProofAction", userId: authz.userId }) };
  }
}

export async function recordBookingPaymentProofReferenceAction(
  input: RecordBookingPaymentProofReferenceActionInput,
): Promise<BookingPaymentProofActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to verify booking payments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = recordBookingPaymentProofReferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid reference." };
  }

  try {
    await bookingPaymentProofService.recordGcashReference(
      parsed.data.proofId,
      parsed.data.gcashReference,
      authz.userId,
    );
    revalidatePath("/dashboard/bookings");
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "recordBookingPaymentProofReferenceAction", userId: authz.userId }) };
  }
}

export async function rejectBookingPaymentProofAction(
  input: RejectBookingPaymentProofActionInput,
): Promise<BookingPaymentProofActionState> {
  const authz = await requireEmployee(
    PERMISSIONS.BOOKINGS_MANAGE,
    "You don't have permission to verify booking payments.",
  );
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = rejectBookingPaymentProofSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rejection." };
  }

  try {
    const result = await bookingPaymentProofService.rejectBookingPaymentProof(
      parsed.data.proofId,
      parsed.data.reason,
      { employeeId: authz.employeeId, actorUserId: authz.userId },
    );

    revalidatePath("/dashboard/bookings");
    return { error: null, alreadyResolved: result.alreadyResolved };
  } catch (error) {
    return { error: toActionError(error, { action: "rejectBookingPaymentProofAction", userId: authz.userId }) };
  }
}
