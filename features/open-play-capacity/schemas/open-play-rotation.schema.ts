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

export const moveQueueUnitAfterInputSchema = z.object({
  date: z.string().min(1),
  movingRegistrationIds: z.array(z.string().min(1)).min(1, "Select at least one player to move."),
  targetRegistrationId: z.string().min(1, "Choose who to move after."),
});

export type MoveQueueUnitAfterInput = z.infer<typeof moveQueueUnitAfterInputSchema>;

// "build the group swap same as tv display" — exchanges which group two
// waiting players belong to (a forming foursome short on skill fit trades
// one player for another), from the Next up preview box. Symmetric by
// design: both players simply trade partyId, so group sizes never change
// and there's nothing to validate about capacity.
export const swapPartyMemberInputSchema = z
  .object({
    date: z.string().min(1),
    memberARegistrationId: z.string().min(1),
    memberBRegistrationId: z.string().min(1),
  })
  .refine((value) => value.memberARegistrationId !== value.memberBRegistrationId, {
    message: "Pick two different players to swap.",
  });

export type SwapPartyMemberInput = z.infer<typeof swapPartyMemberInputSchema>;
