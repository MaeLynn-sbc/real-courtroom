import { formatAssignmentAnnouncement, joinNamesForSpeech } from "./tv-display-client";
import type { DisplayCourtActive } from "@/services/display/display.service";

function court(names: string[], name = "Court 2"): DisplayCourtActive {
  return {
    id: "court-1",
    name,
    state: "op",
    players: names.map((n) => ({ name: n })),
    startAt: "2026-07-28T00:00:00.000Z",
    endAt: "2026-07-28T01:00:00.000Z",
    next: null,
  };
}

describe("joinNamesForSpeech", () => {
  it("returns a single name as-is", () => {
    expect(joinNamesForSpeech(["Ana"])).toBe("Ana");
  });

  it("joins two names with 'and'", () => {
    expect(joinNamesForSpeech(["Ana", "Ben"])).toBe("Ana and Ben");
  });

  it("joins three or more names with commas and a trailing 'and'", () => {
    expect(joinNamesForSpeech(["Ana", "Ben", "Carla"])).toBe("Ana, Ben, and Carla");
    expect(joinNamesForSpeech(["Ana", "Ben", "Carla", "Dana"])).toBe("Ana, Ben, Carla, and Dana");
  });
});

describe("formatAssignmentAnnouncement", () => {
  it("reads 'Attention: <names>, please proceed to <court>.' with the court spoken last", () => {
    expect(formatAssignmentAnnouncement(court(["Ana"], "Court 2"))).toBe(
      "Attention: Ana, please proceed to Court 2.",
    );
  });

  it("lists every name in order, not abbreviated to 'and partner(s)'", () => {
    expect(formatAssignmentAnnouncement(court(["Ana", "Ben"], "Court 1"))).toBe(
      "Attention: Ana and Ben, please proceed to Court 1.",
    );
    expect(formatAssignmentAnnouncement(court(["Ana", "Ben", "Carla", "Dana"], "Court 3"))).toBe(
      "Attention: Ana, Ben, Carla, and Dana, please proceed to Court 3.",
    );
  });

  it("returns an empty string for a court with no players (nothing to announce)", () => {
    expect(formatAssignmentAnnouncement(court([], "Court 1"))).toBe("");
  });
});
