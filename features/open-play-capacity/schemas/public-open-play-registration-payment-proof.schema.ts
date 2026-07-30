import { z } from "zod";

// Mirrors features/bookings/schemas/booking-payment-proof.schema.ts's
// submitBookingPaymentProofSchema exactly — same shape, same reasoning:
// status/resolvedByEmployeeId/resolvedAt/rejectionReason are
// deliberately absent so a normal request can't even construct them;
// the forbidden-value test bypasses this schema entirely to prove the
// SERVICE also refuses them, not just this layer.
export const submitOpenPlayRegistrationPaymentProofSchema = z.object({
  registrationId: z.string().min(1),
  // Optional as long as a screenshot is attached (screenshot is required
  // below, unconditionally) — removed from the customer-facing upload
  // entirely (the screenshot IS the proof; retyping a reference between
  // apps was pure friction). Blank/whitespace normalizes to null,
  // matching the now-nullable column (prisma/migrations/
  // 38_open_play_gcash_reference_optional). Mirrors
  // booking-payment-proof.schema.ts's own gcashReference exactly.
  gcashReference: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
  submittedAmountCents: z.coerce.number().int().positive("Enter the amount you sent."),
  screenshot: z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    dataBase64: z.string().min(1, "Attach a screenshot of your payment confirmation."),
  }),
});

export type SubmitOpenPlayRegistrationPaymentProofActionInput = z.infer<
  typeof submitOpenPlayRegistrationPaymentProofSchema
>;
