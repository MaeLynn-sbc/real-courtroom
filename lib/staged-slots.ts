import type { StagedGroupSlot } from "@/lib/generated/prisma/enums";

// The virtual paddle racks (owner, 2026-09-17). Six, in turn order.
// Rack 1 goes on court first; when it does, every rack behind it moves
// up one. The first three stored names predate the racks (they were
// "Next up / After that / Then") and are kept so old rows still mean
// the same thing.
export const STAGED_SLOTS: StagedGroupSlot[] = ["NEXT_UP", "AFTER_THAT", "THEN", "RACK_4", "RACK_5", "RACK_6"];

export const STAGED_SLOT_VALUES = ["NEXT_UP", "AFTER_THAT", "THEN", "RACK_4", "RACK_5", "RACK_6"] as const;

export function stagedSlotNumber(slot: StagedGroupSlot): number {
  return STAGED_SLOTS.indexOf(slot) + 1;
}

export function stagedSlotLabel(slot: StagedGroupSlot): string {
  return `Rack ${stagedSlotNumber(slot)}`;
}

// The rack right behind this one, or null for the last rack.
export function slotBehind(slot: StagedGroupSlot): StagedGroupSlot | null {
  return STAGED_SLOTS[STAGED_SLOTS.indexOf(slot) + 1] ?? null;
}

// An empty record keyed by every rack, for per-rack UI state.
export function perSlot<T>(value: T): Record<StagedGroupSlot, T> {
  return Object.fromEntries(STAGED_SLOTS.map((slot) => [slot, value])) as Record<StagedGroupSlot, T>;
}
