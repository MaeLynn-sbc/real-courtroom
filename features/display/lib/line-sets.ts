import type { DisplayData, DisplayLinePlayer } from "@/services/display/display.service";

export const SET_SIZE = 4;

export interface LineSet {
  number: number;
  names: string[];
  // Names with skill level, for colour coding. Skill is null when the
  // server did not send it (older payload).
  players: { name: string; skill: DisplayLinePlayer["skill"] | null }[];
  // A staged set is real: staff composed it and it is what goes on court
  // next. A preview set is only where the queue order puts people right
  // now, and reshuffles as players arrive or leave.
  kind: "staged" | "preview";
  label: string;
}

const STAGED_LABELS: Record<"NEXT_UP" | "AFTER_THAT" | "THEN", string> = {
  NEXT_UP: "Next up",
  AFTER_THAT: "After that",
  THEN: "Then",
};
const STAGED_ORDER = ["NEXT_UP", "AFTER_THAT", "THEN"] as const;

// Pack waiting units (a pair who registered together is one unit) into
// sets of four IN QUEUE ORDER, never splitting a unit: when the next
// unit does not fit the set being built, that set closes short and the
// unit opens the next one. First come, first served is the whole point
// of replacing the paddle box, so nothing here reorders anyone.
export function packUnits<T>(units: T[][], size: number = SET_SIZE): T[][] {
  const sets: T[][] = [];
  let current: T[] = [];
  for (const unit of units) {
    const members = unit.slice(0, size);
    if (current.length > 0 && current.length + members.length > size) {
      sets.push(current);
      current = [];
    }
    current.push(...members);
    if (current.length === size) {
      sets.push(current);
      current = [];
    }
  }
  if (current.length > 0) sets.push(current);
  return sets;
}

// The whole line: staged groups first (real, in slot order, skipping
// empty slots), then the waiting queue as preview sets, numbered
// continuously so a player can find their set number at a glance.
export function buildLine(data: Pick<DisplayData, "queue" | "queueUnits" | "stagedGroups">): LineSet[] {
  const line: LineSet[] = [];
  for (const slot of STAGED_ORDER) {
    const group = data.stagedGroups.find((g) => g.slot === slot);
    if (!group || group.names.length === 0) continue;
    const players = group.members ?? group.names.map((name) => ({ name, skill: null }));
    line.push({ number: line.length + 1, names: group.names, players, kind: "staged", label: STAGED_LABELS[slot] });
  }
  const units: { name: string; skill: DisplayLinePlayer["skill"] | null }[][] =
    data.queueUnits ?? data.queue.map((name) => [{ name, skill: null }]);
  for (const players of packUnits(units)) {
    line.push({
      number: line.length + 1,
      names: players.map((player) => player.name),
      players,
      kind: "preview",
      label: `Set ${line.length + 1}`,
    });
  }
  return line;
}
