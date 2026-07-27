import { z } from "zod";

// Cancellation policy Gate 1, customer-facing lookup/cancel — phone is
// the only "auth" a public, unauthenticated customer has (same shape as
// the public /lookup page's reference+phone pair; open-play has no
// separate reference code, so phone+night stands in for it).
export const cancelPublicOpenPlayRegistrationSchema = z.object({
  registrationId: z.string().min(1),
  phone: z.string().min(1, "Enter your phone number."),
});

export type CancelPublicOpenPlayRegistrationInput = z.infer<typeof cancelPublicOpenPlayRegistrationSchema>;
