import { act, fireEvent, render, screen } from "@testing-library/react";

import { PublicBookingForm } from "./public-booking-form";
import { createPublicBookingAction } from "@/actions/public-booking.actions";
import { addPublicCoachToBookingAction } from "@/actions/public-coaching.actions";
import type { CourtHoursSettings, GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-booking.actions", () => ({
  createPublicBookingAction: jest.fn(),
}));
jest.mock("@/actions/public-coaching.actions", () => ({
  addPublicCoachToBookingAction: jest.fn(),
}));
jest.mock("@/actions/public-booking-payment-proof.actions", () => ({
  submitPublicBookingPaymentProofAction: jest.fn(),
}));

const mockedCreateBooking = createPublicBookingAction as jest.MockedFunction<typeof createPublicBookingAction>;
const mockedAddCoach = addPublicCoachToBookingAction as jest.MockedFunction<typeof addPublicCoachToBookingAction>;

const courts = [{ id: "court-1", name: "Court 1", hourlyRateCents: 35000 }];

const courtHours: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  facilityCloseTimes: { "0": "22:00", "1": "22:00", "2": "22:00", "3": "22:00", "4": "22:00", "5": "22:00", "6": "22:00" },
  fridaySaturdayCloseTime: "23:00",
  courtCloseTimes: {},
  businessDateRolloverHour: 3,
};

const gcashInfo: GcashPaymentInfo = { qrImageUrl: null, accountName: "The Courtroom", accountNumber: "0917 000 0000" };

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
    mockedCreateBooking.mockResolvedValue({
      error: null,
      bookingId: "booking-1",
      bookingReference: "BR-0001",
      requiresPayment: true,
      totalAmountCents: 35000, // ₱350 court-only
      availableCoaches: [{ id: "coach-1", name: "Coach Ana", rates: [{ groupSize: 1, priceCents: 40000 }] }], // ₱400
    });
  });

  async function bookAndReachConfirmation() {
    render(
      <PublicBookingForm
        courts={courts}
        courtHours={courtHours}
        gcashInfo={gcashInfo}
        contactPhone="0917 000 0000"
        contactFacebookUrl=""
      />,
    );

    await typeAsync(screen.getByLabelText("Name"), "Test Guest");
    await typeAsync(screen.getByLabelText("Phone number"), "09171234567");
    await clickAsync(screen.getByRole("button", { name: /book now/i }));
    await screen.findByText("BR-0001");
  }

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
