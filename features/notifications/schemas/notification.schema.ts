import { z } from "zod";

export const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Enter a title.").max(200),
  body: z.string().min(1, "Enter a message.").max(5000),
  expiresAt: z.coerce.date().optional(),
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

export const updateAnnouncementSchema = z.object({
  title: z.string().min(1, "Enter a title.").max(200).optional(),
  body: z.string().min(1, "Enter a message.").max(5000).optional(),
  expiresAt: z.coerce.date().optional(),
});

export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
