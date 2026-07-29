import { act, fireEvent, render, screen } from "@testing-library/react";

import { BookingForm } from "./booking-form";
import { createBookingAction } from "@/actions/booking.actions";
import type { CourtHoursSettings } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/booking.actions", () => ({
  createBookingAction: jest.fn(),
}));

// Silences next/navigation's useRouter, which this component calls but
// this test never exercises (no submit path here).
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

void (createBookingAction as jest.MockedFunction<typeof createBookingAction>);

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
