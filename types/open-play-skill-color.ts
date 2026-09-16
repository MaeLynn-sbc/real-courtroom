import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

// One colour per skill level, used wherever a player's name is listed
// for stacking purposes — the staff rotation board and the /rtv line
// display. Owner (2026-09-17): "the names should be colour coded so it
// would be easy to stack." Colour only, no label on the public screen:
// a colour reads from across the room, and the legend says what it
// means. Tailwind's own palette so the same class works on the dark TV
// and the light dashboard.
export const OPEN_PLAY_SKILL_COLOR: Record<OpenPlaySkillLevel, { text: string; dot: string }> = {
  BEGINNER: { text: "text-emerald-400", dot: "bg-emerald-400" },
  NOVICE: { text: "text-sky-400", dot: "bg-sky-400" },
  INTERMEDIATE: { text: "text-amber-400", dot: "bg-amber-400" },
  ADVANCED: { text: "text-rose-400", dot: "bg-rose-400" },
};

export function skillTextClass(level: OpenPlaySkillLevel | null | undefined): string {
  return level ? OPEN_PLAY_SKILL_COLOR[level].text : "";
}
