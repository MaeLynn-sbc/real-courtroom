import { createAnnouncementRepeater } from "./announcement-repeater";

describe("createAnnouncementRepeater", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("speaks immediately, then repeats (getRepeatCount - 1) more times, one gapMs apart", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 6_000, getRepeatCount: () => 2 });

    repeater.schedule("Attention: Ana, please proceed to Court 1.");
    expect(speak).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_999);
    expect(speak).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1);
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenNthCalledWith(2, "Attention: Ana, please proceed to Court 1.");

    jest.advanceTimersByTime(60_000);
    expect(speak).toHaveBeenCalledTimes(2);
  });

  it("plays exactly once when repeat count is 1 — the 'go back to once' setting", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 6_000, getRepeatCount: () => 1 });

    repeater.schedule("Attention: Ana, please proceed to Court 1.");
    expect(speak).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(60_000);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("plays every configured repeat for a higher count", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 1_000, getRepeatCount: () => 4 });

    repeater.schedule("Attention: Ana, please proceed to Court 1.");
    jest.advanceTimersByTime(1_000);
    jest.advanceTimersByTime(1_000);
    jest.advanceTimersByTime(1_000);

    expect(speak).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(10_000);
    expect(speak).toHaveBeenCalledTimes(4);
  });

  // The actual requirement this whole feature hinges on: a new
  // assignment interrupting a still-pending repeat must win, not queue
  // up behind it — no backlog of stale repeats.
  it("a new schedule() call cancels the previous announcement's pending repeat entirely", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 6_000, getRepeatCount: () => 2 });

    repeater.schedule("Attention: Ana, please proceed to Court 1.");
    expect(speak).toHaveBeenCalledTimes(1);

    // Court 2 gets a new assignment 2s later — well before Court 1's
    // own repeat (due at +6s) would have fired.
    jest.advanceTimersByTime(2_000);
    repeater.schedule("Attention: Ben, please proceed to Court 2.");
    expect(speak).toHaveBeenCalledTimes(2);
    expect(speak).toHaveBeenNthCalledWith(1, "Attention: Ana, please proceed to Court 1.");
    expect(speak).toHaveBeenNthCalledWith(2, "Attention: Ben, please proceed to Court 2.");

    // Advance past where Court 1's repeat WOULD have fired (t=6s from
    // its own schedule() call, i.e. 4s from now) — it must not.
    jest.advanceTimersByTime(4_000);
    expect(speak).toHaveBeenCalledTimes(2); // still just the two originals, no Court 1 repeat

    // Court 2's own repeat, scheduled from ITS schedule() call at t=2s,
    // is due at t=8s (2s ago + 6s) — 2s further out from here.
    jest.advanceTimersByTime(2_000);
    expect(speak).toHaveBeenCalledTimes(3);
    expect(speak).toHaveBeenNthCalledWith(3, "Attention: Ben, please proceed to Court 2.");
  });

  it("cancelPending() drops a scheduled repeat without cancelling the original speak", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 6_000, getRepeatCount: () => 2 });

    repeater.schedule("Attention: Ana, please proceed to Court 1.");
    expect(speak).toHaveBeenCalledTimes(1);

    repeater.cancelPending();
    jest.advanceTimersByTime(60_000);
    expect(speak).toHaveBeenCalledTimes(1);
  });

  it("cancelPending() is a no-op when nothing is pending", () => {
    const speak = jest.fn();
    const repeater = createAnnouncementRepeater({ speak, gapMs: 6_000, getRepeatCount: () => 2 });
    expect(() => repeater.cancelPending()).not.toThrow();
    expect(speak).not.toHaveBeenCalled();
  });
});
