import { z } from "zod";

// Shared shape for both create and update. firstName/lastName/phone/
// photoUrl live on Employee; email lives on the underlying User (optional
// — unlike Player, a staff account doesn't require one).
const employeeProfileSchema = z.object({
  firstName: z.string().min(1, "Enter a first name.").max(100),
  lastName: z.string().min(1, "Enter a last name.").max(100),
  phone: z.string().max(50).optional(),
  photoUrl: z.string().max(500).optional(),
  email: z.string().email("Enter a valid email address.").optional(),
});

export const createEmployeeSchema = employeeProfileSchema.extend({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters.")
    .max(50)
    .regex(/^[a-z0-9_.-]+$/i, "Username may only contain letters, numbers, dots, hyphens, and underscores."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  roleId: z.string().min(1, "Select a role."),
});
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeSchema = employeeProfileSchema;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changeRoleSchema = z.object({
  roleId: z.string().min(1, "Select a role."),
});
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;

export const setActiveSchema = z.object({
  isActive: z.boolean(),
});
export type SetActiveInput = z.infer<typeof setActiveSchema>;
