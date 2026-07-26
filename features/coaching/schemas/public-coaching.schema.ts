import { z } from "zod";

// Deliberately narrow — bookingId/coachId/groupSize ONLY. No source, no
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
});
export type PublicAddCoachInput = z.infer<typeof publicAddCoachSchema>;
