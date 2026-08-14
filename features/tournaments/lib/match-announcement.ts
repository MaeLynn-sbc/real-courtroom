import type { matchService } from "@/services/tournaments/match.service";

type Matches = Awaited<ReturnType<typeof matchService.listMatchesByCategory>>;
type MatchTeam = Matches[number]["team1"] | Matches[number]["team2"];

// Owner request (2026-08-15): "add here announce button... please
// announce the players then announce who are the winners. put a mic
// button" — pure text-building helpers for match-card.tsx's local
// speechSynthesis mic button, split into their own module (no "use
// client", no server-action imports) so they can be unit-tested
// directly, the same "pure formatting, colocated test" precedent as
// tournament-tv-display-client.tsx's own formatMatchAnnouncement.
export function firstNameOnly(nameOrEmail: string): string {
  const trimmed = nameOrEmail.trim();
  if (trimmed.includes("@")) {
    return trimmed.split("@")[0] || trimmed;
  }
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function joinNamesForSpeech(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} and ${names[1]}`;
}

export function teamNamesForSpeech(team: MatchTeam): string {
  if (!team) return "";
  const names = [team.player1.user.name ?? team.player1.user.email ?? "Unknown player"];
  if (team.player2) {
    names.push(team.player2.user.name ?? team.player2.user.email ?? "Unknown player");
  }
  return joinNamesForSpeech(names.map(firstNameOnly));
}
