import { act, fireEvent, render, screen } from "@testing-library/react";

import { PublicOpenPlayRegistrationForm } from "./public-open-play-registration-form";
import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-open-play-registration.actions", () => ({
  createPublicOpenPlayRegistrationAction: jest.fn(),
}));
jest.mock("@/actions/public-open-play-registration-payment-proof.actions", () => ({
  submitPublicOpenPlayRegistrationPaymentProofAction: jest.fn(),
}));

const mockedCreate = createPublicOpenPlayRegistrationAction as jest.MockedFunction<
  typeof createPublicOpenPlayRegistrationAction
>;

const gcashInfo: GcashPaymentInfo = {
  qrImageUrl: null,
  accountName: "The Courtroom",
  accountNumber: "0917 000 0000",
};
const nights = [{ date: "2026-08-01", label: "Fri, Aug 1", remainingSeats: 12 }];

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

async function selectOptionAsync(element: Element) {
  await act(async () => {
    fireEvent.pointerDown(element, { pointerType: "mouse" });
    fireEvent.click(element);
  });
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Guest" } });
  fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "09171234567" } });
}

function renderForm(formNights = nights, waitlistEnabled = false) {
  render(
    <PublicOpenPlayRegistrationForm
      waitlistEnabled={waitlistEnabled}
      nights={formNights}
      registrationFeeCents={15000}
      gcashInfo={gcashInfo}
      contactPhone="09171234567"
      contactFacebookUrl="https://facebook.com/thecourtroom"
      waitlistedMessage="We'll get in touch if a slot opens up, and you can pay then."
    />,
  );
}

// Owner, 2026-10-16: "don't show the payment option for the waitlist".
// Customers paid on the first screen, the night filled before they
// submitted, and they landed on the waitlist with their money unrecorded.
// The form now reserves first; only a held seat ever sees payment.
describe("PublicOpenPlayRegistrationForm — reserve first, pay second", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows no GCash details or screenshot upload on the first screen", () => {
    renderForm();
    expect(screen.queryByText("0917 000 0000")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/screenshot/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reserve my seat/i })).toBeInTheDocument();
  });

  it("shows the payment step only once a seat is held", async () => {
    mockedCreate.mockResolvedValue({
      error: null,
      status: "registered",
      registrationId: "reg-1",
      holdExpiresAt: new Date("2026-08-01T11:30:00.000Z"),
    });
    renderForm();
    fillRequiredFields();
    await clickAsync(screen.getByRole("button", { name: /reserve my seat/i }));

    expect(mockedCreate).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Step 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText(/not registered yet/)).toBeInTheDocument();
    expect(screen.getByText("0917 000 0000")).toBeInTheDocument();
  });

  // Reported 2026-10-17: switching to GCash reloaded the page, step 2 was
  // gone, and customers reserved a second time.
  it("comes back to the payment step after a reload while the hold is live", async () => {
    window.localStorage.setItem(
      "courtroom.openPlay.pendingReservation",
      JSON.stringify({
        registrationId: "reg-1",
        playerName: "Jane Guest",
        holdExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      }),
    );
    renderForm();
    expect(await screen.findByText(/Step 2 of 2/)).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
    window.localStorage.clear();
  });

  it("ignores a remembered reservation whose hold has run out", () => {
    window.localStorage.setItem(
      "courtroom.openPlay.pendingReservation",
      JSON.stringify({ registrationId: "reg-1", playerName: "Jane", holdExpiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    renderForm();
    expect(screen.getByRole("button", { name: /reserve my seat/i })).toBeInTheDocument();
    expect(window.localStorage.getItem("courtroom.openPlay.pendingReservation")).toBeNull();
  });

  it("never shows payment to someone who lands on the waitlist", async () => {
    mockedCreate.mockResolvedValue({ error: null, status: "waitlisted", waitlistEntryId: "wl-1" });
    renderForm();
    fillRequiredFields();
    await clickAsync(screen.getByRole("button", { name: /reserve my seat/i }));

    expect(await screen.findByText(/on the waitlist/i)).toBeInTheDocument();
    expect(screen.queryByText("0917 000 0000")).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 2 of 2/)).not.toBeInTheDocument();
  });

  const openAndFull = [
    { date: "2026-08-01", label: "Fri, Aug 1", remainingSeats: 5 },
    { date: "2026-08-02", label: "Sat, Aug 2", remainingSeats: 0 },
  ];

  // Owner, 2026-10-16: "if registration is full kindly disable all buttons".
  it("disables registration the instant a FULL night is picked when the waitlist is off", async () => {
    renderForm(openAndFull);
    await clickAsync(screen.getByRole("combobox", { name: /night/i }));
    await selectOptionAsync(await screen.findByRole("option", { name: /sat, aug 2/i }));

    expect(screen.getByText("This night is full.")).toBeInTheDocument();
    expect(screen.getByText(/no more online slots/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /night is full/i })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /join waitlist/i })).not.toBeInTheDocument();
  });

  it("switches to 'Join waitlist' and says not to pay on a FULL night when the waitlist is on", async () => {
    renderForm(openAndFull, true);
    expect(screen.getByRole("button", { name: /reserve my seat/i })).toBeInTheDocument();

    await clickAsync(screen.getByRole("combobox", { name: /night/i }));
    await selectOptionAsync(await screen.findByRole("option", { name: /sat, aug 2/i }));

    expect(screen.getByText("This night is full.")).toBeInTheDocument();
    expect(screen.getByText(/don't send any payment/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join waitlist/i })).toBeInTheDocument();
  });
});
