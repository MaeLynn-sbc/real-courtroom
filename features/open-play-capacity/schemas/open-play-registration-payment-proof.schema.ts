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
