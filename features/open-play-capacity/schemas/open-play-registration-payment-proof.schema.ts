import { z } from "zod";

// Mirrors features/bookings/schemas/booking-payment-proof.schema.ts's
// rejectBookingPaymentProofSchema exactly.
export const rejectOpenPlayRegistrationPaymentProofSchema = z.object({
  proofId: z.string().min(1),
  reason: z.string().min(1, "Enter a reason for rejecting this payment."),
});

export type RejectOpenPlayRegistrationPaymentProofActionInput = z.infer<
  typeof rejectOpenPlayRegistrationPaymentProofSchema
>;

// Staff-side replacement for the reference removed from the customer
// upload — recorded manually at verification, not asked of the customer.
// Mirrors recordBookingPaymentProofReferenceSchema exactly.
export const recordOpenPlayRegistrationPaymentProofReferenceSchema = z.object({
  proofId: z.string().min(1),
  gcashReference: z.string().min(1, "Enter a reference number."),
});

export type RecordOpenPlayRegistrationPaymentProofReferenceActionInput = z.infer<
  typeof recordOpenPlayRegistrationPaymentProofReferenceSchema
>;
