import type { StagedGroupSlot } from "@/lib/generated/prisma/enums";

// The open play waiting line, in turn order (owner, 2026-09-17):
//
//   Next up -> After that -> Then -> Rack 1 -> ... -> Rack 6
//
// The first three are the groups about to play, shown exactly as /tv has
// always shown them. Behind them sit six virtual paddle racks. When Next
// up goes on court, every position behind it moves up one, so Rack 1
// becomes Then.
//
// Stored names: NEXT_UP, AFTER_THAT, THEN, then RACK_4..RACK_9 — the
// number is the POSITION in the line (4th-9th), not the rack number.
// RACK_4 is displayed as "Rack 1". Always go through stagedSlotLabel.
export const STAGED_SLOT_VALUES = [
  "NEXT_UP",
  "AFTER_THAT",
  "THEN",
  "RACK_4",
  "RACK_5",
  "RACK_6",
  "RACK_7",
  "RACK_8",
  "RACK_9",
] as const;

export const STAGED_SLOTS: StagedGroupSlot[] = [...STAGED_SLOT_VALUES];

// The three about to play, and the six racks behind them.
export const PLAY_SLOTS: StagedGroupSlot[] = STAGED_SLOTS.slice(0, 3);
export const RACK_SLOTS: StagedGroupSlot[] = STAGED_SLOTS.slice(3);

const PLAY_LABELS: Partial<Record<StagedGroupSlot, string>> = {
  NEXT_UP: "Next up",
  AFTER_THAT: "After that",
  THEN: "Then",
};

export function isRackSlot(slot: StagedGroupSlot): boolean {
  return RACK_SLOTS.includes(slot);
}

export function stagedSlotLabel(slot: StagedGroupSlot): string {
  return PLAY_LABELS[slot] ?? `Rack ${RACK_SLOTS.indexOf(slot) + 1}`;
}

// The position right behind this one, or null for the last rack.
export function slotBehind(slot: StagedGroupSlot): StagedGroupSlot | null {
  return STAGED_SLOTS[STAGED_SLOTS.indexOf(slot) + 1] ?? null;
}

// A record keyed by every position, for per-position UI state.
export function perSlot<T>(value: T): Record<StagedGroupSlot, T> {
  return Object.fromEntries(STAGED_SLOTS.map((slot) => [slot, value])) as Record<StagedGroupSlot, T>;
}
