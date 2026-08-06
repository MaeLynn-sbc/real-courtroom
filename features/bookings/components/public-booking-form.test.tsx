import { act, fireEvent, render, screen } from "@testing-library/react";

import { PublicBookingForm } from "./public-booking-form";
import {
  createPublicBookingAction,
  listPublicAvailableCoachesAction,
  listPublicCoachScheduleAction,
  listPublicCourtOccupiedWindowsAction,
} from "@/actions/public-booking.actions";
import { submitPublicBookingPaymentProofAction } from "@/actions/public-booking-payment-proof.actions";
import { addPublicCoachToBookingAction } from "@/actions/public-coaching.actions";
import { saveBookingConfirmation } from "@/features/bookings/lib/booking-confirmation-storage";
import type { CourtHoursSettings, GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-booking.actions", () => ({
  createPublicBookingAction: jest.fn(),
  listPublicCourtOccupiedWindowsAction: jest.fn().mockResolvedValue({ error: null, windows: [] }),
  listPublicAvailableCoachesAction: jest.fn().mockResolvedValue({ error: null, coaches: [] }),
  listPublicCoachScheduleAction: jest.fn().mockResolvedValue({ error: null, windows: [] }),
}));
jest.mock("@/actions/public-coaching.actions", () => ({
  addPublicCoachToBookingAction: jest.fn(),
}));
jest.mock("@/actions/public-booking-payment-proof.actions", () => ({
  submitPublicBookingPaymentProofAction: jest.fn(),
}));

const mockedCreateBooking = createPublicBookingAction as jest.MockedFunction<
  typeof createPublicBookingAction
>;
const mockedAddCoach = addPublicCoachToBookingAction as jest.MockedFunction<
  typeof addPublicCoachToBookingAction
>;
const mockedListOccupiedWindows = listPublicCourtOccupiedWindowsAction as jest.MockedFunction<
  typeof listPublicCourtOccupiedWindowsAction
>;
const mockedListAvailableCoaches = listPublicAvailableCoachesAction as jest.MockedFunction<
  typeof listPublicAvailableCoachesAction
>;
const mockedListCoachSchedule = listPublicCoachScheduleAction as jest.MockedFunction<
  typeof listPublicCoachScheduleAction
>;
const mockedSubmitBookingProof = submitPublicBookingPaymentProofAction as jest.MockedFunction<
  typeof submitPublicBookingPaymentProofAction
>;

const courts = [{ id: "court-1", name: "Court 1", hourlyRateCents: 35000 }];

const courtHours: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  facilityCloseTimes: {
    "0": "22:00",
    "1": "22:00",
    "2": "22:00",
    "3": "22:00",
    "4": "22:00",
    "5": "22:00",
    "6": "22:00",
  },
  fridaySaturdayCloseTime: "23:00",
  courtCloseTimes: {},
  businessDateRolloverHour: 3,
};

const gcashInfo: GcashPaymentInfo = {
  qrImageUrl: null,
  accountName: "The Courtroom",
  accountNumber: "0917 000 0000",
};

// No @testing-library/user-event in this repo's dependencies — fireEvent
// (already available via @testing-library/react) is used throughout
// instead, wrapped in act() where React state updates are involved.

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function typeAsync(element: Element, value: string) {
  await act(async () => {
    fireEvent.change(element, { target: { value } });
  });
}

// Money-path bug (Coach Add-On Not Reflected in the Payment Amount): the
// GCash amount due and pre-filled "amount sent" were set once from the
// court-only total and never recomputed when a coach was added. This
// test drives PublicBookingForm through a real booking + coach-add flow
// and asserts the total, breakdown, and pre-filled amount all update.
// Run BEFORE the fix to confirm it genuinely fails (proven-failing-
// first), then again after to confirm it passes.
describe("PublicBookingForm — coach add-on payment wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Found live (a genuine 9pm test failure, not a real regression):
    // this suite defaults to today's date with no time pinned, so
    // availableTimeOptions goes empty — and Book Now disables — the
    // moment real wall-clock time passes facility-close-minus-1-hour.
    // Fixed to a safe morning hour, same fixed-time approach the sibling
    // describe block below already uses, so this can't go time-of-day
    // flaky again.
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: true,
      totalAmountCents: 35000, // ₱350 court-only
      availableCoaches: [
        { id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] },
      ], // ₱400
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function bookAndReachConfirmation() {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        deepLinkedSlotUnavailable={false}
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");
    await clickAsync(screen.getByRole("button", { name: /book now/i }));
    await screen.findByText("BR-0001");
  }

  // This suite fixes previewCoaches to a single coach — the initial
  // form's own preview picker (not used by this describe block at all)
  // is a separate concern from the POST-booking add-on tested here.
  async function addCoach() {
    mockedAddCoach.mockResolvedValue({ error: null, coachSessionId: "cs-1", priceCents: 40000 });
    await clickAsync(screen.getByRole("combobox", { name: /^coach$/i }));
    await clickAsync(await screen.findByRole("option", { name: "Coach Ana" }));
    await clickAsync(screen.getByRole("combobox", { name: /group size/i }));
    await clickAsync(await screen.findByRole("option", { name: /1 person/i }));
    await clickAsync(screen.getByRole("button", { name: /add coach/i }));
    await screen.findByText("Coach added");
  }

  it("shows only the court total before a coach is added, and pre-fills the amount-sent field with it", async () => {
    await bookAndReachConfirmation();

    expect(screen.getByText("₱350.00")).toBeInTheDocument();
    expect(screen.getByLabelText(/amount sent/i)).toHaveValue(350);
    expect(screen.queryByText("₱400.00")).not.toBeInTheDocument();
  });

  it("updates the total, shows a court+coaching breakdown, and resyncs the untouched amount-sent field once a coach is added", async () => {
    await bookAndReachConfirmation();
    await addCoach();

    expect(screen.getByText("₱400.00")).toBeInTheDocument(); // coaching line
    expect(screen.getByText("₱750.00")).toBeInTheDocument(); // updated total
    expect(screen.getByLabelText(/amount sent/i)).toHaveValue(750);
  });

  it("does not clobber an amount the customer already edited by hand", async () => {
    await bookAndReachConfirmation();

    const amountInput = screen.getByLabelText(/amount sent/i);
    await typeAsync(amountInput, "500");

    await addCoach();

    // The customer's own hand-typed 500 stays put — never silently overwritten.
    expect(screen.getByLabelText(/amount sent/i)).toHaveValue(500);
  });
});

// Reported live on production: a real CONFIRMED booking held Court 1,
// 4-5 PM, but the public form's Time dropdown still offered it — the
// server-side conflict check correctly rejects it at submit (proven
// separately, against real rows, in booking.service.ts's own
// createBookingHold/createBooking transaction), but a customer shouldn't
// have to fill in the whole form and reach a rejection to find that out.
describe("PublicBookingForm — Time dropdown excludes already-booked slots", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it("does not offer an hour already covered by an existing booking for the selected court/date", async () => {
    mockedListOccupiedWindows.mockResolvedValue({
      error: null,
      windows: [
        {
          startAt: new Date(2026, 6, 29, 16, 0).toISOString(),
          endAt: new Date(2026, 6, 29, 17, 0).toISOString(),
        },
      ],
    });

    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        deepLinkedSlotUnavailable={false}
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    await act(async () => {});
    await clickAsync(screen.getByRole("combobox", { name: /^time$/i }));

    expect(screen.queryByRole("option", { name: "4:00 PM" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "3:00 PM" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "5:00 PM" })).toBeInTheDocument();
  });
});

// Reported live: the coach section on the confirmation screen appeared
// blank when no coach was available for the booked slot. Drives the real
// PublicBookingForm -> PublicCoachAddOn tree (not just the child in
// isolation) with an empty availableCoaches array, on both confirmation
// branches (pay-at-venue and requires-payment), to prove the empty-state
// copy and contact fallback actually render where a customer would see
// them, not just in a unit test of the child component alone.
describe("PublicBookingForm — coach section when no coach is available", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function bookWithNoCoachesAvailable() {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl="https://facebook.com/thecourtroom"
        deepLinkedSlotUnavailable={false}
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");
    await clickAsync(screen.getByRole("button", { name: /book now/i }));
    await screen.findByText("BR-0001");
  }

  it("shows the empty-state text and contact fallback on the pay-at-venue confirmation screen", async () => {
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: false,
      totalAmountCents: 35000,
      availableCoaches: [],
    });

    await bookWithNoCoachesAvailable();

    expect(screen.getByText(/no coaches available for this time/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /facebook/i }).length).toBeGreaterThan(0);
  });

  it("shows the empty-state text and contact fallback on the requires-payment hold screen", async () => {
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: true,
      totalAmountCents: 35000,
      availableCoaches: [],
    });

    await bookWithNoCoachesAvailable();

    expect(screen.getByText(/no coaches available for this time/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /facebook/i }).length).toBeGreaterThan(0);
  });
});

// Reported live: coaching was only offered AFTER a booking already
// existed, on a separate screen — customers clicked "Book Now" and never
// saw it. Coach selection now lives in the initial form itself, and the
// Total shown there must already include the coach fee before submit.
describe("PublicBookingForm — coach selection moved into the initial form", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: true,
      totalAmountCents: 35000, // ₱350 court-only
      availableCoaches: [
        { id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderForm() {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        deepLinkedSlotUnavailable={false}
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );
  }

  it("shows each available coach as a clickable card — no dropdown, whether there's one or several", async () => {
    mockedListAvailableCoaches.mockResolvedValue({
      error: null,
      coaches: [
        { id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] },
        { id: "coach-2", name: "Coach Ben", rates: [{ groupSize: 1, priceCents: 45000 }] },
      ],
    });

    renderForm();

    expect(await screen.findByRole("button", { name: "Coach Ana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coach Ben" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /coach \(optional\)/i })).not.toBeInTheDocument();
  });

  it("adds the coach fee to the Total preview once a coach card and group size are chosen, before the form is even submitted", async () => {
    mockedListAvailableCoaches.mockResolvedValue({
      error: null,
      coaches: [{ id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] }],
    });

    renderForm();
    await screen.findByRole("button", { name: "Coach Ana" });

    expect(screen.getByText("₱350.00")).toBeInTheDocument();

    await clickAsync(screen.getByRole("button", { name: "Coach Ana" }));
    await clickAsync(screen.getByRole("combobox", { name: /group size/i }));
    await clickAsync(await screen.findByRole("option", { name: /1 person/i }));

    expect(screen.getByText("Coach rate:")).toBeInTheDocument();
    expect(screen.getByText("₱750.00")).toBeInTheDocument(); // 350 court + 400 coach
  });

  it("submits the booking and adds the coach automatically in one click — no separate 'Add coach' step", async () => {
    mockedListAvailableCoaches.mockResolvedValue({
      error: null,
      coaches: [{ id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] }],
    });
    mockedAddCoach.mockResolvedValue({ error: null, coachSessionId: "cs-1", priceCents: 40000 });

    renderForm();
    await clickAsync(await screen.findByRole("button", { name: "Coach Ana" }));
    await clickAsync(screen.getByRole("combobox", { name: /group size/i }));
    await clickAsync(await screen.findByRole("option", { name: /1 person/i }));

    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");
    await clickAsync(screen.getByRole("button", { name: /book now/i }));

    await screen.findByText("BR-0001");

    expect(mockedAddCoach).toHaveBeenCalledWith({
      bookingId: "booking-1",
      coachId: "coach-1",
      groupSize: 1,
    });
    // Already reflected on the confirmation screen, no extra click needed.
    expect(screen.getByText("Coach added")).toBeInTheDocument();
    expect(screen.getByText("₱750.00")).toBeInTheDocument();
  });

  it("does not add a coach when its card is clicked again to deselect it, even though one was chosen", async () => {
    mockedListAvailableCoaches.mockResolvedValue({
      error: null,
      coaches: [{ id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] }],
    });

    renderForm();
    await clickAsync(await screen.findByRole("button", { name: "Coach Ana" }));
    await clickAsync(screen.getByRole("combobox", { name: /group size/i }));
    await clickAsync(await screen.findByRole("option", { name: /1 person/i }));
    await clickAsync(screen.getByRole("button", { name: "Coach Ana" })); // click again to deselect

    expect(screen.getByText("₱350.00")).toBeInTheDocument();

    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");
    await clickAsync(screen.getByRole("button", { name: /book now/i }));

    await screen.findByText("BR-0001");
    expect(mockedAddCoach).not.toHaveBeenCalled();
  });

  it("reveals a coach's schedule inline when 'See availability' is clicked", async () => {
    mockedListAvailableCoaches.mockResolvedValue({
      error: null,
      coaches: [{ id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] }],
    });
    mockedListCoachSchedule.mockResolvedValue({
      error: null,
      windows: [
        {
          startAt: new Date(2026, 6, 30, 9, 0).toISOString(),
          endAt: new Date(2026, 6, 30, 12, 0).toISOString(),
        },
      ],
    });

    renderForm();
    await screen.findByRole("button", { name: "Coach Ana" });

    await clickAsync(screen.getByRole("button", { name: /see coach ana's availability/i }));

    expect(mockedListCoachSchedule).toHaveBeenCalledWith("coach-1");
    expect(await screen.findByText(/9:00 AM–12:00 PM/)).toBeInTheDocument();
  });
});

// Reported live: customers clicked "Book Now" and walked away without
// ever sending GCash payment or uploading proof — dead AWAITING_PAYMENT
// holds tying up a slot until the hold expired on its own. Same fix
// already shipped for open-play registration: the screenshot is now
// required in the same click as "Book Now," not a separate step.
describe("PublicBookingForm — payment screenshot required when prepayment is on", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: true,
      totalAmountCents: 35000,
      availableCoaches: [],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function renderForm() {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        deepLinkedSlotUnavailable={false}
        requiresPrepayment
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );
  }

  it("blocks submission and never calls the booking action when no screenshot is attached", async () => {
    renderForm();
    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");

    await clickAsync(screen.getByRole("button", { name: /book now/i }));

    expect(
      screen.getByText("Please upload your proof of payment to complete your booking."),
    ).toBeInTheDocument();
    expect(mockedCreateBooking).not.toHaveBeenCalled();
  });

  it("creates the booking and submits the proof in one click when a screenshot is attached", async () => {
    mockedSubmitBookingProof.mockResolvedValue({ error: null, proofId: "proof-1" });

    renderForm();
    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");

    const fileInput = document.getElementById("bookingScreenshot") as HTMLInputElement;
    const file = new File(["x"], "gcash-receipt.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await clickAsync(screen.getByRole("button", { name: /book now/i }));

    await screen.findByText("Booking received ✓");
    expect(mockedSubmitBookingProof).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: "booking-1", submittedAmountCents: 35000 }),
    );
  });

  it("falls back to the manual retry upload, without losing the booking, if the proof submission itself fails", async () => {
    mockedSubmitBookingProof.mockResolvedValue({ error: "Upload service unavailable." });

    renderForm();
    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");

    const fileInput = document.getElementById("bookingScreenshot") as HTMLInputElement;
    const file = new File(["x"], "gcash-receipt.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await clickAsync(screen.getByRole("button", { name: /book now/i }));

    await screen.findByText("BR-0001");
    expect(screen.getByText(/Pay via GCash/i)).toBeInTheDocument();
    expect(screen.queryByText("Booking received ✓")).not.toBeInTheDocument();
  });
});

// Real incident (2026-08-06): a customer switching to the GCash app to
// pay and back can trigger a full page reload on /book?courtId=...
// &date=...&time=..., which used to hard-block on a server-rendered
// "That slot was just taken" page — even when the "taken" slot was the
// customer's OWN just-created hold. Proven here by driving
// PublicBookingForm directly with deepLinkedSlotUnavailable=true (what
// app/book/page.tsx now always passes when its own availability check
// finds the slot unavailable) and asserting the two outcomes: a
// genuine conflict still shows the real message, but a matching local
// record (this browser's own prior success, saved by saveBookingConfirmation)
// restores the actual confirmation instead.
describe("PublicBookingForm — deep-link reload recovery (2026-08-06 incident)", () => {
  const DEEP_LINK_DATE = "2026-07-29";
  const DEEP_LINK_TIME = "12:00";

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 6, 29, 9, 0, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows the real 'slot just taken' message when no local record exists for this browser — proven failing-first against the exact bug shape (no silent restore of someone else's slot)", async () => {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        initialCourtId="court-1"
        initialDate={DEEP_LINK_DATE}
        initialTime={DEEP_LINK_TIME}
        deepLinkedSlotUnavailable
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    await act(async () => {});

    expect(screen.getByText("That slot was just taken")).toBeInTheDocument();
  });

  it("restores the customer's own confirmation instead of the false 'taken' message, when this exact slot has a fresh local record", async () => {
    saveBookingConfirmation("court-1", DEEP_LINK_DATE, DEEP_LINK_TIME, "60", {
      confirmation: {
        bookingId: "booking-reload-1",
        bookingReference: "BR-RELOAD-1",
        shortCode: "REL0AD",
        courtId: "court-1",
        courtName: "Court 1",
        date: DEEP_LINK_DATE,
        time: DEEP_LINK_TIME,
        durationMinutes: 60,
        guestName: "Reload Test Guest",
        guestPhone: "09171230099",
        totalAmountCents: 35000,
        requiresPayment: true,
        availableCoaches: [],
        holdExpiresAt: new Date(2026, 6, 29, 9, 30, 0),
      },
      hasSubmittedProof: false,
    });

    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        initialCourtId="court-1"
        initialDate={DEEP_LINK_DATE}
        initialTime={DEEP_LINK_TIME}
        deepLinkedSlotUnavailable
        requiresPrepayment
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    // The restore runs in a useEffect, after mount — flush it.
    await act(async () => {});

    expect(screen.queryByText("That slot was just taken")).not.toBeInTheDocument();
    expect(screen.getByText("REL0AD")).toBeInTheDocument();
    expect(screen.getByText("BR-RELOAD-1")).toBeInTheDocument();
  });

  it("does not restore a record saved for a DIFFERENT slot — a reload for a genuinely different unavailable slot still shows the real message", async () => {
    saveBookingConfirmation("court-1", DEEP_LINK_DATE, "14:00", "60", {
      confirmation: {
        bookingId: "booking-reload-2",
        bookingReference: "BR-RELOAD-2",
        shortCode: "OTHER1",
        courtId: "court-1",
        courtName: "Court 1",
        date: DEEP_LINK_DATE,
        time: "14:00",
        durationMinutes: 60,
        guestName: "Different Slot Guest",
        guestPhone: "09171230098",
        totalAmountCents: 35000,
        requiresPayment: true,
        availableCoaches: [],
        holdExpiresAt: new Date(2026, 6, 29, 9, 30, 0),
      },
      hasSubmittedProof: false,
    });

    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
        initialCourtId="court-1"
        initialDate={DEEP_LINK_DATE}
        initialTime={DEEP_LINK_TIME}
        deepLinkedSlotUnavailable
        requiresPrepayment={false}
        pageConfirmationCopy="Your slot is reserved. We'll text you at {phone} to confirm."
      />,
    );

    await act(async () => {});

    expect(screen.getByText("That slot was just taken")).toBeInTheDocument();
    expect(screen.queryByText("OTHER1")).not.toBeInTheDocument();
  });
});
