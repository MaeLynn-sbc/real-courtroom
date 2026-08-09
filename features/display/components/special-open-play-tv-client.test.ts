import { formatSpecialAnnouncement } from "./special-open-play-tv-client";
import type { SpecialDisplayCourt } from "@/services/display/special-display.service";

function court(playerNames: string[], courtLabel = "Court 2"): SpecialDisplayCourt {
  return { courtLabel, playerNames, announcementRequestedAt: null };
}

describe("formatSpecialAnnouncement", () => {
  it("reads 'Attention: <names>, please proceed to <court>.' with the court spoken last", () => {
    expect(formatSpecialAnnouncement(court(["Ana T."], "Court 2"))).toBe(
      "Attention: Ana, please proceed to Court 2.",
    );
  });

  it("lists every name in order for a group", () => {
    expect(formatSpecialAnnouncement(court(["Ana T.", "Ben C.", "Cara D.", "Dan E."], "Court 1"))).toBe(
      "Attention: Ana, Ben, Cara, and Dan, please proceed to Court 1.",
    );
  });

  // Owner decision, same as the tournament/Open Play displays: spoken
  // names are bare first names only — the on-screen card still shows
  // "First L.", but a trailing initial can read oddly through TTS.
  it("speaks bare first names only, dropping the last-initial the on-screen card shows", () => {
    const text = formatSpecialAnnouncement(court(["Ana Tan"], "Court 3"));
    expect(text).toContain("Ana");
    expect(text).not.toContain("Tan");
  });

  it("returns an empty string for a court with nobody on it", () => {
    expect(formatSpecialAnnouncement(court([], "Court 1"))).toBe("");
  });
});
