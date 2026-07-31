import {
  formatAssignmentAnnouncement,
  formatGameWarningAnnouncement,
  isGameWarningActive,
  isTimeUpFlashing,
  joinNamesForSpeech,
} from "./tv-display-client";
import type { DisplayCourtActive } from "@/services/display/display.service";

function court(names: string[], name = "Court 2"): DisplayCourtActive {
  return {
    id: "court-1",
    name,
    state: "op",
    players: names.map((n) => ({ name: n })),
    startAt: "2026-07-28T00:00:00.000Z",
    endAt: "2026-07-28T01:00:00.000Z",
    announcementRequestedAt: null,
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

  // Reported live: with a 4-name group, the "First L." card name
  // (already shortened server-side for the TV's visual card) still made
  // the spoken announcement too long to track by ear. Voice drops the
  // last-initial entirely, reading bare first names only.
  it("reads bare first names only, dropping the card's own last-initial", () => {
    expect(formatAssignmentAnnouncement(court(["Albert D."], "Court 1"))).toBe(
      "Attention: Albert, please proceed to Court 1.",
    );
    expect(formatAssignmentAnnouncement(court(["Bend J.", "Miguel M.", "Albert D.", "Harry C."], "Court 1"))).toBe(
      "Attention: Bend, Miguel, Albert, and Harry, please proceed to Court 1.",
    );
  });
});

describe("isTimeUpFlashing", () => {
  const endAt = "2026-07-28T10:00:00.000Z";
  const endMs = new Date(endAt).getTime();
  const flashDurationMs = 180_000; // 3 minutes

  it("is false before the end time — nothing to flash yet", () => {
    expect(isTimeUpFlashing(endAt, endMs - 1, flashDurationMs)).toBe(false);
  });

  it("is true exactly at the end time", () => {
    expect(isTimeUpFlashing(endAt, endMs, flashDurationMs)).toBe(true);
  });

  it("stays true for the rest of the flash window", () => {
    expect(isTimeUpFlashing(endAt, endMs + 1, flashDurationMs)).toBe(true);
    expect(isTimeUpFlashing(endAt, endMs + flashDurationMs, flashDurationMs)).toBe(true);
  });

  it("is false once the flash window has elapsed — stops on its own", () => {
    expect(isTimeUpFlashing(endAt, endMs + flashDurationMs + 1, flashDurationMs)).toBe(false);
    expect(isTimeUpFlashing(endAt, endMs + 60 * 60_000, flashDurationMs)).toBe(false);
  });
});

describe("isGameWarningActive", () => {
  const endAt = "2026-07-28T10:00:00.000Z";
  const endMs = new Date(endAt).getTime();
  const warningMs = 60_000; // 1 minute

  it("is false with more than the warning window left", () => {
    expect(isGameWarningActive(endAt, endMs - warningMs - 1, warningMs)).toBe(false);
  });

  it("is true the instant the warning window is entered", () => {
    expect(isGameWarningActive(endAt, endMs - warningMs, warningMs)).toBe(true);
  });

  it("stays true right up to the end time", () => {
    expect(isGameWarningActive(endAt, endMs - 1, warningMs)).toBe(true);
  });

  it("is false once time is actually up — isTimeUpFlashing takes over from there, never both at once", () => {
    expect(isGameWarningActive(endAt, endMs, warningMs)).toBe(false);
    expect(isGameWarningActive(endAt, endMs + 1, warningMs)).toBe(false);
  });
});

describe("formatGameWarningAnnouncement", () => {
  it('reads "Court, one minute remaining." for the 1-minute default', () => {
    expect(formatGameWarningAnnouncement({ name: "Court 2" }, 1)).toBe("Court 2, one minute remaining.");
  });

  it("reads a plain number of minutes for any other owner-configured warning time", () => {
    expect(formatGameWarningAnnouncement({ name: "Court 3" }, 2)).toBe("Court 3, 2 minutes remaining.");
    expect(formatGameWarningAnnouncement({ name: "Court 1" }, 5)).toBe("Court 1, 5 minutes remaining.");
  });
});
