import { z } from "zod";

// Self-service change — the account owner proves they know the current
// password, distinct from features/employees/schemas/employee.schema.ts's
// resetPasswordSchema, where an admin resets it unilaterally with no
// current-password check at all.
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z.string().min(8, "Password must be at least 8 characters."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match.",
    path: ["confirmPassword"],
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
