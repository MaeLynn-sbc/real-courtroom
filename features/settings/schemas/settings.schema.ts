import { z } from "zod";

export const upsertSettingSchema = z.object({
  key: z
    .string()
    .min(1, "Enter a setting key.")
    .max(100)
    .regex(/^[a-z0-9_.:-]+$/i, "Use letters, numbers, dots, colons, hyphens, and underscores only."),
  value: z.string().max(2000),
  description: z.string().max(500).optional(),
});
export type UpsertSettingInput = z.infer<typeof upsertSettingSchema>;
