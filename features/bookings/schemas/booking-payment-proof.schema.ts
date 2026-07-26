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
  gcashReference: z.string().min(1, "Enter the GCash reference number."),
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
