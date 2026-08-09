import {
  formatSpecialAnnouncement,
  formatSpecialOneMinuteWarning,
  formatSpecialTimesUpAnnouncement,
  getEffectiveTimerStart,
  isOneMinuteWarningDue,
} from "./special-open-play-tv-client";
import type { SpecialDisplayCourt } from "@/services/display/special-display.service";

function court(playerNames: string[], courtLabel = "Court 2", startedAt: string | null = null): SpecialDisplayCourt {
  return {
    courtLabel,
    playerNames,
    announcementRequestedAt: null,
    timesUpRequestedAt: null,
    startedAt,
    timerStartedAt: null,
  };
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

describe("formatSpecialTimesUpAnnouncement", () => {
  it("reads '<court>, your time is up!'", () => {
    expect(formatSpecialTimesUpAnnouncement(court(["Ana T."], "Court 2"))).toBe(
      "Court 2, your time is up!",
    );
  });

  it("doesn't name any players — it's a court-wide cue, not a roll call", () => {
    const text = formatSpecialTimesUpAnnouncement(court(["Ana T.", "Ben C."], "Court 3"));
    expect(text).not.toContain("Ana");
    expect(text).not.toContain("Ben");
  });

  it("returns an empty string for a court with nobody on it", () => {
    expect(formatSpecialTimesUpAnnouncement(court([], "Court 1"))).toBe("");
  });
});

describe("formatSpecialOneMinuteWarning", () => {
  it("reads '<court>, 1 minute remaining.'", () => {
    expect(formatSpecialOneMinuteWarning(court(["Ana T."], "Court 2"))).toBe("Court 2, 1 minute remaining.");
  });

  it("returns an empty string for a court with nobody on it", () => {
    expect(formatSpecialOneMinuteWarning(court([], "Court 1"))).toBe("");
  });
});

describe("isOneMinuteWarningDue", () => {
  const START = new Date("2026-08-09T10:00:00.000Z").toISOString();

  it("is not due before the 19-minute mark (20-minute target, 1-minute warning)", () => {
    const justBefore = new Date("2026-08-09T10:18:59.999Z").getTime();
    expect(isOneMinuteWarningDue(START, justBefore)).toBe(false);
  });

  it("is due exactly at the 19-minute mark", () => {
    const at19 = new Date("2026-08-09T10:19:00.000Z").getTime();
    expect(isOneMinuteWarningDue(START, at19)).toBe(true);
  });

  it("stops being due once the full 20-minute target has passed", () => {
    const at20 = new Date("2026-08-09T10:20:00.000Z").getTime();
    expect(isOneMinuteWarningDue(START, at20)).toBe(false);
  });
});

describe("getEffectiveTimerStart", () => {
  const ASSIGNED_AT = "2026-08-09T10:00:00.000Z";
  const MANUAL_START = "2026-08-09T10:00:30.000Z";

  it("prefers timerStartedAt (staff pressed Start) over auto-start", () => {
    const now = new Date("2026-08-09T10:15:00.000Z").getTime();
    expect(getEffectiveTimerStart(ASSIGNED_AT, MANUAL_START, now)).toBe(MANUAL_START);
  });

  it("returns null within the 3-minute grace period when Start was never pressed", () => {
    const justBefore = new Date("2026-08-09T10:02:59.999Z").getTime();
    expect(getEffectiveTimerStart(ASSIGNED_AT, null, justBefore)).toBeNull();
  });

  it("auto-starts at exactly startedAt+3min when the button was never pressed", () => {
    const at3min = new Date("2026-08-09T10:03:00.000Z").getTime();
    expect(getEffectiveTimerStart(ASSIGNED_AT, null, at3min)).toBe("2026-08-09T10:03:00.000Z");
  });

  it("returns null when there's no group on the court at all", () => {
    const now = new Date("2026-08-09T10:15:00.000Z").getTime();
    expect(getEffectiveTimerStart(null, null, now)).toBeNull();
  });
});
