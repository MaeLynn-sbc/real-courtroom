import { z } from "zod";

export const proposeAssignmentInputSchema = z.object({
  date: z.string().min(1),
  courtId: z.string().min(1),
});

export type ProposeAssignmentInput = z.infer<typeof proposeAssignmentInputSchema>;

export const manualAssignmentInputSchema = z.object({
  date: z.string().min(1),
  courtId: z.string().min(1),
  registrationIds: z.array(z.string().min(1)).length(4, "Pick exactly 4 players — doubles only."),
});

export type ManualAssignmentInput = z.infer<typeof manualAssignmentInputSchema>;

export const assignmentIdInputSchema = z.object({
  assignmentId: z.string().min(1),
});

export type AssignmentIdInput = z.infer<typeof assignmentIdInputSchema>;

export const queueEntryIdInputSchema = z.object({
  queueEntryId: z.string().min(1),
});

export type QueueEntryIdInput = z.infer<typeof queueEntryIdInputSchema>;
