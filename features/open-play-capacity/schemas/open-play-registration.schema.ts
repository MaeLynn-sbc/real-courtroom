import { z } from "zod";

export const registerWalkInInputSchema = z.object({
  sessionId: z.string().min(1),
  playerName: z.string().min(1, "Enter a name.").max(200),
  phone: z.string().min(1, "Enter a phone number.").max(50),
  // BUILD-SPEC.md §4: required for every open play registration.
  skillLevel: z.enum(["BEGINNER", "NOVICE", "INTERMEDIATE", "ADVANCED"]),
  partyId: z.string().max(100).optional(),
  // Gate 2 review follow-up (BUILD-SPEC.md §9): this action is Fri/Sat-
  // only by construction (sessionId always required above), so the
  // ₱150 registration fee always applies — same required-ness as
  // settleTabInputSchema's own method/paymentMethodId.
  method: z.enum(["CASH", "GCASH"]),
  gcashReference: z.string().max(100).optional(),
  paymentMethodId: z.string().min(1),
});

export type RegisterWalkInInput = z.infer<typeof registerWalkInInputSchema>;

export const releaseRegistrationInputSchema = z.object({
  registrationId: z.string().min(1),
});

export type ReleaseRegistrationInput = z.infer<typeof releaseRegistrationInputSchema>;

// Cancellation policy Gate 1 — staff refund path. reason is required
// (min 1), same "no anonymous refunds" shape as PlayerTab's write-off
// schema.
export const refundRegistrationInputSchema = z.object({
  registrationId: z.string().min(1),
  amountCents: z.coerce.number().int().positive("Enter a valid refund amount."),
  reason: z.string().min(1, "Enter a reason for this refund."),
});

export type RefundRegistrationInput = z.infer<typeof refundRegistrationInputSchema>;

// Reported live: no way anywhere to fix a typo'd name or phone number on
// an existing registration short of cancelling and re-registering. Both
// fields optional at this layer — the service only writes whichever one
// was actually changed — but at least one must be present, checked
// below via refine (an empty {} update is never a meaningful request).
export const updateRegistrationDetailsInputSchema = z
  .object({
    registrationId: z.string().min(1),
    playerName: z.string().trim().min(1, "Name can't be empty.").max(200).optional(),
    phone: z.string().trim().min(1, "Phone can't be empty.").max(50).optional(),
  })
  .refine((value) => value.playerName !== undefined || value.phone !== undefined, {
    message: "Enter a name or phone number to update.",
  });

export type UpdateRegistrationDetailsInput = z.infer<typeof updateRegistrationDetailsInputSchema>;
