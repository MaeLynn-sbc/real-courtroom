// How an open play game reads on a tab (owner, 2026-09-17): "when the
// customer will settle tab, make sure the details appear, e.g.
// OP court 1 7:20-7:40pm". One formatter for the stored description
// (written when the game is billed) and for older charges rebuilt from
// their game at read time, so both look the same.
const time = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

export function gameChargeDescription(game: {
  courtName: string | null | undefined;
  startedAt: Date | null | undefined;
  endedAt: Date | null | undefined;
  // The game format's length ("15 min"), when the game recorded one.
  gameMinutes?: number | null;
}): string {
  const parts = ["OP"];
  if (game.courtName) parts.push(game.courtName);
  if (game.startedAt && game.endedAt) {
    parts.push(`${time.format(game.startedAt)}–${time.format(game.endedAt)}`);
  } else if (game.startedAt) {
    parts.push(`from ${time.format(game.startedAt)}`);
  }
  if (game.gameMinutes) parts.push(`${game.gameMinutes} min`);
  return parts.join(" · ");
}
