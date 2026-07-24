import { getCourtBookingWindow, isWithinCourtBookingWindow } from "@/lib/court-hours";
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
