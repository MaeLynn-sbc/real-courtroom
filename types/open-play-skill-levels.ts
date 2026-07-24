import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

// BUILD-SPEC.md §4 — explicit 1-4 ordering, not relied on implicitly from
// the Prisma enum's declaration order (which does happen to match, but a
// future reorder of the enum shouldn't silently reorder every dropdown/
// count-by-level display that uses this instead). Descriptions are
// required onscreen everywhere the level is picked — "people self-rate
// badly without them."
export const OPEN_PLAY_SKILL_LEVELS: Record<
  OpenPlaySkillLevel,
  { order: 1 | 2 | 3 | 4; label: string; description: string }
> = {
  BEGINNER: { order: 1, label: "Beginner", description: "New to the sport" },
  NOVICE: { order: 2, label: "Novice", description: "Knows the rules, still learning placement" },
  INTERMEDIATE: {
    order: 3,
    label: "Intermediate",
    description: "Consistent rallies, understands kitchen strategy",
  },
  ADVANCED: { order: 4, label: "Advanced", description: "Competitive play" },
};

// Iteration order for dropdowns/breakdowns — sorted by `order`, not object
// key order (which happens to already match, but don't rely on that).
export const OPEN_PLAY_SKILL_LEVEL_ORDER: OpenPlaySkillLevel[] = (
  Object.keys(OPEN_PLAY_SKILL_LEVELS) as OpenPlaySkillLevel[]
).sort((a, b) => OPEN_PLAY_SKILL_LEVELS[a].order - OPEN_PLAY_SKILL_LEVELS[b].order);
