import {
  bookingWholeHours,
  clipTimeWindow,
  coachSessionWindow,
  coachSpanFitsBooking,
  coachStartOffsets,
  maxCoachHours,
  subtractTimeWindows,
} from "./coach-session-window";

const at = (h: number, m = 0) => new Date(2031, 3, 7, h, m);
const win = (s: number, e: number) => ({ startAt: at(s), endAt: at(e) });

describe("coach session window", () => {
  it("derives the coached window from the booking start, offset and hours", () => {
    expect(coachSessionWindow(at(17), { startOffsetHours: 0, hours: 1 })).toEqual(win(17, 18));
    expect(coachSessionWindow(at(17), { startOffsetHours: 1, hours: 1 })).toEqual(win(18, 19));
    expect(coachSessionWindow(at(17), { startOffsetHours: 0, hours: 2 })).toEqual(win(17, 19));
  });

  it("counts whole booking hours, never below one", () => {
    expect(bookingWholeHours(at(17), at(19))).toBe(2);
    expect(bookingWholeHours(at(17), at(17, 30))).toBe(1);
    expect(bookingWholeHours(at(17), at(19, 30))).toBe(2);
  });

  it("rejects a span that does not fit the court time, or is not whole positive hours", () => {
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: 1, hours: 1 })).toBe(true);
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: 1, hours: 2 })).toBe(false);
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: 2, hours: 1 })).toBe(false);
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: -1, hours: 1 })).toBe(false);
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: 0, hours: 0 })).toBe(false);
    expect(coachSpanFitsBooking(at(17), at(19), { startOffsetHours: 0.5, hours: 1 })).toBe(false);
  });

  it("offers only starts whose whole coached window sits inside one free window", () => {
    // 2h court 5-7 PM; coach free 6-8 PM only: one hour is bookable, at 6.
    expect(coachStartOffsets(at(17), at(19), 1, [win(18, 20)])).toEqual([1]);
    expect(coachStartOffsets(at(17), at(19), 2, [win(18, 20)])).toEqual([]);
    // Fully free: every start works for 1h, only the first for 2h.
    expect(coachStartOffsets(at(17), at(19), 1, [win(16, 20)])).toEqual([0, 1]);
    expect(coachStartOffsets(at(17), at(19), 2, [win(16, 20)])).toEqual([0]);
    // Two adjacent free windows are not stitched into one 2h window.
    expect(coachStartOffsets(at(17), at(19), 2, [win(17, 18), win(18, 19)])).toEqual([]);
    expect(coachStartOffsets(at(17), at(19), 1, [win(17, 18), win(18, 19)])).toEqual([0, 1]);
    // A 30-minute stated window never covers a whole hour.
    expect(coachStartOffsets(at(17), at(18), 1, [win(17, 17.5)])).toEqual([]);
  });

  it("caps the hours picker at the longest window the coach can give", () => {
    expect(maxCoachHours(at(17), at(20), [win(17, 20)])).toBe(3);
    expect(maxCoachHours(at(17), at(20), [win(18, 20)])).toBe(2);
    expect(maxCoachHours(at(17), at(20), [win(18, 19)])).toBe(1);
    expect(maxCoachHours(at(17), at(20), [])).toBe(0);
  });

  it("subtracts booked ranges and clips to a range", () => {
    expect(subtractTimeWindows(win(16, 20), [win(17, 18)])).toEqual([win(16, 17), win(18, 20)]);
    expect(subtractTimeWindows(win(16, 20), [win(15, 17), win(19, 21)])).toEqual([win(17, 19)]);
    expect(subtractTimeWindows(win(16, 20), [win(15, 21)])).toEqual([]);
    expect(clipTimeWindow(win(15, 21), win(17, 19))).toEqual(win(17, 19));
    expect(clipTimeWindow(win(15, 16), win(17, 19))).toBeNull();
  });
});
