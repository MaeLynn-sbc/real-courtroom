import {
  classifyCourtSlot,
  getCourtBookingWindow,
  isBeforeFridaySaturdayOpenPlayCutoff,
  isWithinCourtBookingWindow,
} from "@/lib/court-hours";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

const SETTINGS: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  facilityCloseTimes: {
    "0": "23:00",
    "1": "23:00",
    "2": "23:00",
    "3": "23:00",
    "4": "23:00",
    "5": "23:00",
    "6": "23:00",
  },
  fridaySaturdayCloseTime: "18:00",
  courtCloseTimes: {
    "Court 1": "18:00",
    "Court 2": "20:00",
    "Court 3": "00:00",
  },
  businessDateRolloverHour: 3,
};

// Mon Jul 20 2026, Fri Jul 24 2026, Sat Jul 25 2026 respectively.
const MONDAY = new Date(2026, 6, 20);
const FRIDAY = new Date(2026, 6, 24);
const SATURDAY = new Date(2026, 6, 25);

describe("getCourtBookingWindow", () => {
  it("resolves Court 3's 00:00 sentinel to facility close, not midnight-as-zero", () => {
    expect(getCourtBookingWindow(SETTINGS, "Court 3", MONDAY)).toEqual({
      openMinutes: 7 * 60,
      closeMinutes: 23 * 60,
    });
  });

  it("uses each court's own weekday cutoff", () => {
    expect(getCourtBookingWindow(SETTINGS, "Court 1", MONDAY).closeMinutes).toBe(18 * 60);
    expect(getCourtBookingWindow(SETTINGS, "Court 2", MONDAY).closeMinutes).toBe(20 * 60);
  });

  it("applies the Fri/Sat all-courts cutoff regardless of the per-court weekday cutoff", () => {
    expect(getCourtBookingWindow(SETTINGS, "Court 3", FRIDAY).closeMinutes).toBe(18 * 60);
    expect(getCourtBookingWindow(SETTINGS, "Court 2", SATURDAY).closeMinutes).toBe(18 * 60);
  });

  it("caps a court's cutoff at facility close even if configured later", () => {
    const lateCourtSettings: CourtHoursSettings = {
      ...SETTINGS,
      courtCloseTimes: { ...SETTINGS.courtCloseTimes, "Court 2": "23:30" },
    };
    expect(getCourtBookingWindow(lateCourtSettings, "Court 2", MONDAY).closeMinutes).toBe(23 * 60);
  });

  it("treats a facility close of 00:00 as midnight (end of day), not zero", () => {
    const midnightClose: CourtHoursSettings = {
      ...SETTINGS,
      facilityCloseTimes: { ...SETTINGS.facilityCloseTimes, "1": "00:00" },
    };
    expect(getCourtBookingWindow(midnightClose, "Court 3", MONDAY).closeMinutes).toBe(24 * 60);
  });
});

describe("isWithinCourtBookingWindow", () => {
  it("allows a Court 3 booking ending exactly at facility close (11PM)", () => {
    const startAt = new Date(2026, 6, 20, 22, 0);
    const endAt = new Date(2026, 6, 20, 23, 0);
    expect(isWithinCourtBookingWindow(SETTINGS, "Court 3", startAt, endAt)).toBe(true);
  });

  it("blocks a Court 3 booking that would run past facility close", () => {
    const startAt = new Date(2026, 6, 20, 23, 0);
    const endAt = new Date(2026, 6, 21, 0, 0);
    expect(isWithinCourtBookingWindow(SETTINGS, "Court 3", startAt, endAt)).toBe(false);
  });

  it("allows a Court 3 booking ending exactly at midnight when facility close is set to midnight", () => {
    const midnightClose: CourtHoursSettings = {
      ...SETTINGS,
      facilityCloseTimes: { ...SETTINGS.facilityCloseTimes, "1": "00:00" },
    };
    const startAt = new Date(2026, 6, 20, 23, 0);
    const endAt = new Date(2026, 6, 21, 0, 0);
    expect(isWithinCourtBookingWindow(midnightClose, "Court 3", startAt, endAt)).toBe(true);
  });

  it("blocks a Court 1 booking that starts before its 6PM Monday cutoff", () => {
    const startAt = new Date(2026, 6, 20, 19, 0);
    const endAt = new Date(2026, 6, 20, 20, 0);
    expect(isWithinCourtBookingWindow(SETTINGS, "Court 1", startAt, endAt)).toBe(false);
  });
});

describe("classifyCourtSlot", () => {
  // Court 3, Monday, 7am-11pm window (from SETTINGS above).
  const window = getCourtBookingWindow(SETTINGS, "Court 3", MONDAY);
  const booking = {
    startAt: new Date(2026, 6, 20, 7, 0),
    endAt: new Date(2026, 6, 20, 10, 0),
  };

  function slot(hour: number) {
    return {
      hour,
      slotStart: new Date(2026, 6, 20, hour, 0),
      slotEnd: new Date(2026, 6, 20, hour + 1, 0),
      window,
      maintenanceRanges: [],
      bookedRanges: [booking],
    };
  }

  // The bug this test exists to pin: the original inline version of
  // this logic checked "past" before "booked," so an elapsed hour
  // inside a real, active booking read as generically "Past" instead
  // of "Booked" on the homepage grid — found live (a Court 3 booking
  // 7-10am; at 9:40am, 8am and 9am both showed "Past," not "Booked").
  it("reads BOOKED, not past, for an elapsed hour inside a real booking", () => {
    const now = new Date(2026, 6, 20, 9, 40).getTime(); // 9:40am — 7,8,9am all elapsed
    expect(classifyCourtSlot({ ...slot(7), now })).toBe("booked");
    expect(classifyCourtSlot({ ...slot(8), now })).toBe("booked");
    expect(classifyCourtSlot({ ...slot(9), now })).toBe("booked");
  });

  it("reads PAST for a genuinely free, elapsed hour", () => {
    const now = new Date(2026, 6, 20, 11, 15).getTime(); // 11:15am — 10am is free and elapsed
    expect(classifyCourtSlot({ ...slot(10), now })).toBe("past");
  });

  it("reads AVAILABLE for a free hour that hasn't happened yet", () => {
    const now = new Date(2026, 6, 20, 9, 40).getTime();
    expect(classifyCourtSlot({ ...slot(14), now })).toBe("available");
  });

  it("excludes the booking's own end hour (exclusive end boundary)", () => {
    const now = new Date(2026, 6, 20, 9, 40).getTime();
    // The booking ends AT 10am — the 10am slot itself must not overlap it.
    expect(classifyCourtSlot({ ...slot(10), now })).not.toBe("booked");
  });

  it("still reads UNAVAILABLE for maintenance even if also past and booked", () => {
    const now = new Date(2026, 6, 20, 9, 40).getTime();
    expect(
      classifyCourtSlot({
        ...slot(8),
        now,
        maintenanceRanges: [{ startAt: new Date(2026, 6, 20, 8, 0), endAt: new Date(2026, 6, 20, 9, 0) }],
      }),
    ).toBe("unavailable");
  });
});

// Reported live: Fri/Sat open-play walk-in registration was ALWAYS
// routed to the P150 unlimited capacity system regardless of time of
// day — the page deciding this only ever checked the calendar date.
// This is the pure decision function the fix now routes through.
describe("isBeforeFridaySaturdayOpenPlayCutoff", () => {
  it("is always true on a non-Fri/Sat date — the split doesn't apply there", () => {
    const anyTime = new Date(2026, 6, 20, 23, 59);
    expect(isBeforeFridaySaturdayOpenPlayCutoff(SETTINGS, MONDAY, anyTime)).toBe(true);
  });

  it("is true before the Fri/Sat cutoff (18:00 in SETTINGS)", () => {
    const morning = new Date(2026, 6, 24, 9, 0); // Friday 9am
    expect(isBeforeFridaySaturdayOpenPlayCutoff(SETTINGS, FRIDAY, morning)).toBe(true);
  });

  it("is false exactly at the cutoff and after — Open Play has taken over", () => {
    const atCutoff = new Date(2026, 6, 24, 18, 0);
    const afterCutoff = new Date(2026, 6, 25, 21, 0); // Saturday 9pm, checked against SATURDAY
    expect(isBeforeFridaySaturdayOpenPlayCutoff(SETTINGS, FRIDAY, atCutoff)).toBe(false);
    expect(isBeforeFridaySaturdayOpenPlayCutoff(SETTINGS, SATURDAY, afterCutoff)).toBe(false);
  });

  it('treats a "00:00" cutoff as end-of-day, not as "no cutoff at all" — unlike a court\'s own cutoff sentinel', () => {
    const midnightCutoffSettings: CourtHoursSettings = { ...SETTINGS, fridaySaturdayCloseTime: "00:00" };
    const lateEvening = new Date(2026, 6, 24, 23, 30);
    expect(isBeforeFridaySaturdayOpenPlayCutoff(midnightCutoffSettings, FRIDAY, lateEvening)).toBe(true);
  });
});
