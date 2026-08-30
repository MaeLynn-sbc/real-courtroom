import { z } from "zod";

// Deliberately narrow — bookingId/coachId/groupSize/hours ONLY. No source, no
// isOutsideAvailability. This is the load-bearing part of the public
// surface (Gate 3 review): Zod strips any unrecognized keys from the
// input by default, so even if a crafted request body includes
// source/isOutsideAvailability, parsed.data here never has them —
// actions/public-coaching.actions.ts then hardcodes source itself as a
// separate function argument (not part of this shape at all) and never
// forwards isOutsideAvailability into the service call either. Three
// independent layers, not one: this schema, the action's explicit field
// list, and coach-session.service.ts's own `source === "STAFF"` gate on
// honoring the override.
export const publicAddCoachSchema = z.object({
  bookingId: z.string().min(1),
  coachId: z.string().min(1, "Select a coach."),
  groupSize: z.coerce.number().int().min(1, "Group size must be at least 1."),
  // Hours of coaching. Unlike source/isOutsideAvailability above, this IS
  // a legitimate customer choice, so it belongs on the public shape.
  //
  // But it is a MONEY field on an unauthenticated endpoint, so the upper
  // bound is NOT trusted from here. This schema cannot know which booking
  // the request is for, so it only rejects nonsense (< 1, non-integer);
  // the real ceiling — you cannot buy more coaching hours than you have
  // court — is enforced in coach-session.service.ts against the booking's
  // own duration. The picker's cap is a convenience, not the guard.
  hours: z.coerce.number().int().min(1, "Coaching must be at least 1 hour.").optional(),
});
export type PublicAddCoachInput = z.infer<typeof publicAddCoachSchema>;

// bookingId alone — same "bookingId as the capability" trust model as
// publicAddCoachSchema above, no separate ownership token. Which coach
// session to remove is looked up server-side (coach-session.service.ts's
// removeCoachSession), never taken from the client.
export const publicRemoveCoachSchema = z.object({
  bookingId: z.string().min(1),
});
export type PublicRemoveCoachInput = z.infer<typeof publicRemoveCoachSchema>;
