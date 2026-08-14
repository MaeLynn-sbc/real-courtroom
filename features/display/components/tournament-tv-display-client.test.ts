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
    expect(formatMatchAnnouncement(match(["Mae Tanaka"], ["John Alba"], "Court 3"))).toBe(
      "Attention: Mae Tanaka, versus John Alba, please proceed to Court 3.",
    );
  });

  it("joins a doubles pair with 'and', on both sides", () => {
    expect(
      formatMatchAnnouncement(match(["Mae Tanaka", "Jane Cruz"], ["John Alba", "Ben Bautista"], "Court 1")),
    ).toBe("Attention: Mae Tanaka and Jane Cruz, versus John Alba and Ben Bautista, please proceed to Court 1.");
  });

  // Owner request (2026-08-15): "can the voice announcement read the
  // complete names as well?" — speaks whatever's in match.team1/2.names
  // as-is, no first-name-only trimming.
  it("speaks the complete name, not just the first name", () => {
    const text = formatMatchAnnouncement(match(["Mae Tanaka"], ["John Alba"]));
    expect(text).toContain("Mae Tanaka");
    expect(text).toContain("John Alba");
  });

  it("returns an empty string when either side has no names (nothing to announce)", () => {
    expect(formatMatchAnnouncement(match([], ["John Alba"]))).toBe("");
    expect(formatMatchAnnouncement(match(["Mae Tanaka"], []))).toBe("");
  });
});
