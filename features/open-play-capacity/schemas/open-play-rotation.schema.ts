import { z } from "zod";

// Staging pipeline (Next up/After that/Then — reported live: "staff need
// to compose the staging slots, not just watch them fill"). Real, saved
// groups now, not a computed preview.
export const stagedGroupSlotSchema = z.enum(["NEXT_UP", "AFTER_THAT", "THEN"]);

export const proposeAssignmentInputSchema = z.object({
  date: z.string().min(1),
  courtId: z.string().min(1),
});

export type ProposeAssignmentInput = z.infer<typeof proposeAssignmentInputSchema>;

// Reported live: early mornings only 2-3 people show up, and they were
// blocked from playing at all — "Build a group by hand" required
// exactly 4. Doubles (4) is still the normal case, but a court with
// fewer players is real, valid ₱35/game play, not an error. The
// AUTOMATIC skill-matching path (assembleFoursome/proposeNextAssignment)
// is unaffected — it's a genuinely different, still-doubles-only rule.
export const manualAssignmentInputSchema = z.object({
  date: z.string().min(1),
  courtId: z.string().min(1),
  registrationIds: z
    .array(z.string().min(1))
    .min(2, "Pick at least 2 players.")
    .max(4, "A court holds at most 4 players."),
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

// "Put the action where the group is" — assigns a STAGED group (not raw
// registrationIds — those are resolved fresh, server-side, from the real
// group; see assignPendingGroupToCourt's own comment for why that's a
// tightening over the old preview-based version).
export const assignStagedGroupToCourtInputSchema = z.object({
  date: z.string().min(1),
  courtId: z.string().min(1),
  stagedGroupId: z.string().min(1),
});

export type AssignStagedGroupToCourtInput = z.infer<typeof assignStagedGroupToCourtInputSchema>;

// Auto queue: next `size` waiting players, strict FIFO, into `slot`.
export const stageAutoQueueInputSchema = z.object({
  date: z.string().min(1),
  slot: stagedGroupSlotSchema,
  size: z
    .number()
    .int()
    .min(2, "Pick a group size of 2 to 4.")
    .max(4, "Pick a group size of 2 to 4."),
});

export type StageAutoQueueInput = z.infer<typeof stageAutoQueueInputSchema>;

// Build by hand, targeting a slot instead of a court.
export const stageManualGroupInputSchema = z.object({
  date: z.string().min(1),
  slot: stagedGroupSlotSchema,
  registrationIds: z
    .array(z.string().min(1))
    .min(2, "Pick at least 2 players.")
    .max(4, "A group holds at most 4 players."),
});

export type StageManualGroupInput = z.infer<typeof stageManualGroupInputSchema>;

export const stagedGroupIdInputSchema = z.object({
  stagedGroupId: z.string().min(1),
});

export type StagedGroupIdInput = z.infer<typeof stagedGroupIdInputSchema>;

// "Add a player to an existing group" — blocked at 4 server-side; swap is
// deliberately just × (unstageQueueEntryInputSchema, reusing
// queueEntryIdInputSchema) followed by this, not a separate mechanism.
export const addPlayerToStagedGroupInputSchema = z.object({
  stagedGroupId: z.string().min(1),
  registrationId: z.string().min(1),
});

export type AddPlayerToStagedGroupInput = z.infer<typeof addPlayerToStagedGroupInputSchema>;
