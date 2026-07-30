import { z } from "zod";

// Deliberately does NOT include status/resolvedByEmployeeId/resolvedAt/
// rejectionReason — a plain zod .safeParse() strips any unrecognized key
// by default (no .passthrough()), so even a crafted request sending those
// is already stripped before this action's own code ever runs. That's
// layer one. services/booking/booking-payment-proof.service.ts's
// submitBookingPaymentProof hardcoding status="PENDING" regardless of
// what's in its (differently-typed, intentionally wider) input is layer
// two — proven directly against the service in the forbidden-value
// integration test, bypassing this schema entirely, so the proof isn't
// resting on "the schema happened to strip it."
export const submitBookingPaymentProofSchema = z.object({
  bookingId: z.string().min(1),
  // Optional as long as a screenshot is attached (screenshot is
  // required below, unconditionally) — the screenshot IS the proof;
  // the reference is a convenience for staff to find the transaction
  // in the GCash app faster, not a hard requirement. Blank/whitespace
  // normalizes to null, matching the now-nullable column
  // (prisma/migrations/32_gcash_reference_optional).
  gcashReference: z
    .string()
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    }),
  // What the customer states they sent — compared against the booking's
  // totalAmountCents on the verification screen so staff don't have to
  // eyeball two numbers (§8). Never trusted as proof on its own; the
  // screenshot is.
  submittedAmountCents: z.coerce.number().int().positive("Enter the amount you sent."),
  screenshot: z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(1),
    dataBase64: z.string().min(1, "Attach a screenshot of your payment confirmation."),
  }),
});

export type SubmitBookingPaymentProofActionInput = z.infer<typeof submitBookingPaymentProofSchema>;

export const rejectBookingPaymentProofSchema = z.object({
  proofId: z.string().min(1),
  reason: z.string().min(1, "Enter a reason for rejecting this payment."),
});

export type RejectBookingPaymentProofActionInput = z.infer<typeof rejectBookingPaymentProofSchema>;

// Staff-side replacement for the reference removed from the customer
// upload above — recorded manually at verification, not asked of the
// customer.
export const recordBookingPaymentProofReferenceSchema = z.object({
  proofId: z.string().min(1),
  gcashReference: z.string().min(1, "Enter a reference number."),
});

export type RecordBookingPaymentProofReferenceActionInput = z.infer<
  typeof recordBookingPaymentProofReferenceSchema
>;
