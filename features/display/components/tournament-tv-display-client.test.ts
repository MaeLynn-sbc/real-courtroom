import { formatMatchAnnouncement } from "./tournament-tv-display-client";
import type { TournamentDisplayMatch } from "@/services/display/tournament-display.service";

function match(team1Names: string[], team2Names: string[], courtName = "Court 2"): TournamentDisplayMatch {
  return {
    id: "match-1",
    courtName,
    team1: { names: team1Names, number: null },
    team2: { names: team2Names, number: null },
    categoryLabel: "Men's Doubles",
    status: "SCHEDULED",
    announcementRequestedAt: null,
    stagedSlot: null,
  };
}

describe("formatMatchAnnouncement", () => {
  it("reads 'Attention: <team1>, versus <team2>, please proceed to <court>.'", () => {
    expect(formatMatchAnnouncement(match(["Mae T."], ["John A."], "Court 3"))).toBe(
      "Attention: Mae, versus John, please proceed to Court 3.",
    );
  });

  it("joins a doubles pair with 'and', on both sides", () => {
    expect(formatMatchAnnouncement(match(["Mae T.", "Jane C."], ["John A.", "Ben B."], "Court 1"))).toBe(
      "Attention: Mae and Jane, versus John and Ben, please proceed to Court 1.",
    );
  });

  // Owner decision (2026-08-09): spoken names are bare first names only
  // — the on-screen card still shows "First L.", but a trailing initial
  // can read oddly through text-to-speech.
  it("speaks bare first names only, dropping the last-initial the on-screen card shows", () => {
    const text = formatMatchAnnouncement(match(["Mae Tan"], ["John Alba"]));
    expect(text).toContain("Mae");
    expect(text).toContain("John");
    expect(text).not.toContain("Tan");
    expect(text).not.toContain("Alba");
  });

  it("returns an empty string when either side has no names (nothing to announce)", () => {
    expect(formatMatchAnnouncement(match([], ["John A."]))).toBe("");
    expect(formatMatchAnnouncement(match(["Mae T."], []))).toBe("");
  });
});
