// Open play game format (owner, 2026-09-18): the regular format uses the
// open play settings (20 min · ₱35 at the venue), and a switch on the open
// play page selects the short one, 15 min · ₱30. Each game snapshots the
// format when it is put on a court (GameAssignment.gameMinutes /
// gameRateCents), so the switch never rewrites a game already running.
export const SHORT_GAME_MINUTES = 15;
export const SHORT_GAME_RATE_CENTS = 3000;

export interface GameFormat {
  minutes: number;
  rateCents: number;
}

export function currentGameFormat(
  settings: { targetGameMinutes: number; weeknightGameRateCents: number },
  shortGame: boolean,
): GameFormat {
  return shortGame
    ? { minutes: SHORT_GAME_MINUTES, rateCents: SHORT_GAME_RATE_CENTS }
    : { minutes: settings.targetGameMinutes, rateCents: settings.weeknightGameRateCents };
}

// A game's own length, falling back to the settings for games created
// before formats were snapshotted.
export function gameMinutesOf(
  game: { gameMinutes?: number | null },
  fallbackMinutes: number,
): number {
  return game.gameMinutes ?? fallbackMinutes;
}
