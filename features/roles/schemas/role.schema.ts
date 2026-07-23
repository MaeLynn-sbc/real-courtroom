import { z } from "zod";

// `name` (the stable internal key some code paths look a role up by, e.g.
// Player creation's SYSTEM_ROLES.MEMBER) is derived from `label` in the
// service rather than typed separately — one less field, and the two
// rarely need to differ for a role an Owner creates through the workspace.
const roleFormSchema = z.object({
  label: z.string().min(1, "Enter a role name.").max(100),
  description: z.string().max(500).optional(),
  permissionKeys: z.array(z.string()).default([]),
});

export const createRoleSchema = roleFormSchema;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = roleFormSchema;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
