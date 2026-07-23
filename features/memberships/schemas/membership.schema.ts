import { z } from "zod";

const membershipPlanFieldsSchema = z.object({
  name: z.string().min(1, "Enter a plan name.").max(200),
  description: z.string().max(1000).optional(),
  priceCents: z.coerce.number().int().nonnegative(),
  billingPeriod: z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]),
  discountPercent: z.coerce.number().min(0).max(100).optional(),
  priorityBooking: z.boolean().optional(),
});

export const createPlanSchema = membershipPlanFieldsSchema;
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = membershipPlanFieldsSchema.extend({
  isActive: z.boolean().optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const enrollMembershipSchema = z.object({
  membershipPlanId: z.string().min(1, "Select a plan."),
  startDate: z.coerce.date(),
  autoRenew: z.boolean().optional(),
  paymentMethodId: z.string().min(1, "Select a payment method."),
});
export type EnrollMembershipInput = z.infer<typeof enrollMembershipSchema>;

export const changePlanSchema = z.object({
  membershipPlanId: z.string().min(1, "Select a plan."),
});
export type ChangePlanInput = z.infer<typeof changePlanSchema>;

// Used by suspend/cancel actions — an optional reason recorded on the
// MembershipHistory entry.
export const membershipNoteSchema = z.object({
  note: z.string().max(500).optional(),
});
export type MembershipNoteInput = z.infer<typeof membershipNoteSchema>;
