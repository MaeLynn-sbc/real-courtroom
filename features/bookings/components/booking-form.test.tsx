import { act, fireEvent, render, screen } from "@testing-library/react";

import { BookingForm } from "./booking-form";
import { createBookingAction, listCourtOccupiedWindowsAction } from "@/actions/booking.actions";
import { createCoachSessionAction, listAvailableCoachesForSlotAction } from "@/actions/coaching.actions";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/booking.actions", () => ({
  createBookingAction: jest.fn(),
  listCourtOccupiedWindowsAction: jest.fn().mockResolvedValue({ error: null, windows: [] }),
}));

// BookingForm now renders StaffCoachPicker, which fetches on mount even
// in walk-in mode (slotStartAt is always set) — unmocked, the real
// module's next/cache import (revalidatePath) blows up under jsdom (no
// TextEncoder), same reason booking.actions is mocked above.
jest.mock("@/actions/coaching.actions", () => ({
  createCoachSessionAction: jest.fn(),
  listAvailableCoachesForSlotAction: jest.fn().mockResolvedValue({ error: null, coaches: [] }),
}));

// Silences next/navigation's useRouter, which this component calls but
// this test never exercises (no submit path here).
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const courts = [{ id: "court-1", name: "Court 1", hourlyRateCents: 35000, shortSessionPriceCents: 20000 }];

const courtHours: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  facilityCloseTimes: { "0": "22:00", "1": "22:00", "2": "22:00", "3": "22:00", "4": "22:00", "5": "22:00", "6": "22:00" },
  fridaySaturdayCloseTime: "23:00",
  courtCloseTimes: {},
  businessDateRolloverHour: 3,
};

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Base UI's SelectItem only commits a plain "click" when the item is
// already highlighted (e.g. the sole/first item in a short list, which is
// why every other Select interaction in this file happens to work with a
// bare click) — otherwise it requires a preceding pointerdown to set its
// own internal allowMouseSelectionRef gate (see SelectItem.js's onClick).
// Needed here specifically because "2 hours" is neither the first nor the
// currently-selected Duration option.
async function selectOptionAsync(element: Element) {
  await act(async () => {
    fireEvent.pointerDown(element, { pointerType: "mouse" });
    fireEvent.click(element);
  });
}

// Reported live: a front-desk tab left open all shift kept offering an
// already-elapsed start time in Advance mode's Time dropdown, because
// the option list was only ever recomputed from an inline Date.now()
// call — which only re-runs when something else triggers a re-render.
// Nothing here polls or ticks on its own, so a tab sitting idle for
// hours never notices the wall clock moving past a listed hour. Proves
// the fix (useLiveNow, hooks/use-live-now.ts) genuinely self-corrects
// on the passage of time alone — no click, no keystroke, no reopen of
// the form between the two assertions below.
describe("BookingForm — Advance mode Time dropdown stays live", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 59, 0)); // Wed, 9:59 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("removes an hour from the option list once the clock passes it, with no user interaction", async () => {
    render(<BookingForm courts={courts} players={[]} courtHours={courtHours} />);

    await clickAsync(screen.getByRole("button", { name: /advance booking/i }));
    await clickAsync(screen.getByRole("combobox", { name: /time/i }));

    // 9:59 AM: 10:00 AM hasn't started yet, so it's still offered.
    expect(await screen.findByRole("option", { name: "10:00 AM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "11:00 AM" })).toBeInTheDocument();

    // Advance the clock past 10:00 AM and let the live-now interval
    // fire — no fireEvent, no click, nothing else touches the form.
    await act(async () => {
      jest.setSystemTime(new Date(2026, 6, 29, 10, 1, 0));
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.queryByRole("option", { name: "10:00 AM" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "11:00 AM" })).toBeInTheDocument();
  });
});

const mockedListCourtOccupiedWindowsAction = listCourtOccupiedWindowsAction as jest.MockedFunction<
  typeof listCourtOccupiedWindowsAction
>;

// Reported live: BK-20260730-0005 already had Court 1 booked 4-5 PM, but
// the Time dropdown still offered 4:00 PM — staff only found out at
// submit, via the server's own conflict check (kept, unchanged; this is
// a preview layered on top of it, not a replacement).
describe("BookingForm — Time dropdown excludes already-booked slots", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("does not offer an hour already covered by an existing booking for the selected court/date", async () => {
    mockedListCourtOccupiedWindowsAction.mockResolvedValue({
      error: null,
      windows: [
        { startAt: new Date(2026, 6, 29, 16, 0).toISOString(), endAt: new Date(2026, 6, 29, 17, 0).toISOString() },
      ],
    });

    render(<BookingForm courts={courts} players={[]} courtHours={courtHours} />);

    await clickAsync(screen.getByRole("button", { name: /advance booking/i }));
    await clickAsync(await screen.findByRole("combobox", { name: /time/i }));

    expect(screen.queryByRole("option", { name: "4:00 PM" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3:00 PM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "5:00 PM" })).toBeInTheDocument();
  });

  it("re-includes a hour once a wider booked window no longer overlaps a shorter duration", async () => {
    // A 2-hour booking (4-6 PM) blocks a 2-hour candidate starting at
    // 3 PM (3-5 overlaps 4-6) but not one starting at 4 PM itself being
    // excluded differently from a 1-hour duration — this proves duration
    // is actually part of the overlap math, not just the fetch trigger.
    mockedListCourtOccupiedWindowsAction.mockResolvedValue({
      error: null,
      windows: [
        { startAt: new Date(2026, 6, 29, 16, 0).toISOString(), endAt: new Date(2026, 6, 29, 18, 0).toISOString() },
      ],
    });

    render(<BookingForm courts={courts} players={[]} courtHours={courtHours} />);

    await clickAsync(screen.getByRole("button", { name: /advance booking/i }));
    await clickAsync(await screen.findByRole("combobox", { name: /duration/i }));
    await selectOptionAsync(await screen.findByRole("option", { name: "2 hours" }));

    await clickAsync(await screen.findByRole("combobox", { name: /time/i }));

    // 2-hour candidates at 3 PM (3-5) and 5 PM (5-7) both overlap the
    // 4-6 PM booking; only slots fully outside it remain.
    expect(screen.queryByRole("option", { name: "3:00 PM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "4:00 PM" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "5:00 PM" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "6:00 PM" })).toBeInTheDocument();
  });
});

const mockedCreateBookingAction = createBookingAction as jest.MockedFunction<typeof createBookingAction>;
const mockedCreateCoachSessionAction = createCoachSessionAction as jest.MockedFunction<typeof createCoachSessionAction>;
const mockedListAvailableCoachesForSlotAction = listAvailableCoachesForSlotAction as jest.MockedFunction<
  typeof listAvailableCoachesForSlotAction
>;

// Staff booking form's coach section (item 2 of the "staff advance
// booking blocked / add live coach availability" request): a live
// pre-submission preview, not the post-creation add-on PublicCoachAddOn
// and CoachSessionPanel already are. No rates.length filter (staff see
// every coach free for the slot, priced or not) — proves the
// group-size-specific NO_RATE_SET block instead.
describe("BookingForm — staff coach section", () => {
  beforeEach(() => {
    mockedListAvailableCoachesForSlotAction.mockResolvedValue({
      error: null,
      coaches: [{ id: "coach-1", name: "Coach Dhudz", rates: [{ groupSize: 2, priceCents: 50000 }] }],
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("blocks submission with the NO_RATE_SET message for an unpriced group size, and clears once a priced size is chosen", async () => {
    render(<BookingForm courts={courts} players={[]} courtHours={courtHours} />);

    await clickAsync(await screen.findByRole("combobox", { name: /coach/i }));
    await clickAsync(await screen.findByRole("option", { name: "Coach Dhudz" }));

    const groupSizeInput = await screen.findByLabelText(/group size/i);
    fireEvent.change(groupSizeInput, { target: { value: "5" } });

    expect(await screen.findByText("No rate is set for this coach at this group size.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create booking/i })).toBeDisabled();

    fireEvent.change(groupSizeInput, { target: { value: "2" } });

    expect(screen.queryByText("No rate is set for this coach at this group size.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create booking/i })).not.toBeDisabled();
    expect(screen.getAllByText("₱500.00").length).toBeGreaterThanOrEqual(1);
  });

  it("attaches the selected coach to the newly created booking on submit", async () => {
    mockedCreateBookingAction.mockResolvedValue({ error: null, bookingId: "booking-1" });
    mockedCreateCoachSessionAction.mockResolvedValue({ error: null, coachSessionId: "session-1" });

    render(<BookingForm courts={courts} players={[]} courtHours={courtHours} />);

    fireEvent.change(screen.getByLabelText("Player"), { target: { value: "Walk-in Guest" } });

    await clickAsync(await screen.findByRole("combobox", { name: /coach/i }));
    await clickAsync(await screen.findByRole("option", { name: "Coach Dhudz" }));
    fireEvent.change(await screen.findByLabelText(/group size/i), { target: { value: "2" } });

    await clickAsync(screen.getByRole("button", { name: /create booking/i }));

    expect(mockedCreateBookingAction).toHaveBeenCalledTimes(1);
    expect(mockedCreateCoachSessionAction).toHaveBeenCalledWith({
      bookingId: "booking-1",
      coachId: "coach-1",
      groupSize: 2,
    });
  });
});
