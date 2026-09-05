// The four playoff stage labels, in bracket order.
//
// Shared so the admin picker, the public playoff section and any results
// list all name a stage identically — the alternative is three literal
// maps that drift, which is how "Bronze" becomes "3rd place" on one
// screen and "Battle for bronze" on another.
//
// Order matters: Object.entries preserves insertion order, and both the
// picker and the public grouping iterate this to lay stages out
// left-to-right as they are played.
export const STAGE_LABELS: Record<string, string> = {
  ELIMINATION: "Elimination",
  QUARTERFINAL: "Quarterfinal",
  SEMIFINAL: "Semifinal",
  BRONZE: "Bronze",
  FINAL: "Final",
};

// Compact codes for the badge on a match card — "SF" reads better than
// "Semifinal" in a 40px chip, and matches the reference results sheet.
export const STAGE_CODES: Record<string, string> = {
  ELIMINATION: "ELIM",
  QUARTERFINAL: "QF",
  SEMIFINAL: "SF",
  BRONZE: "BRONZE",
  FINAL: "FINALS",
};

export const STAGE_ORDER = Object.keys(STAGE_LABELS);
