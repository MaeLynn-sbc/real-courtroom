import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PublicOpenPlayRegistrationForm } from "./public-open-play-registration-form";
import { cancelPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration-cancellation.actions";
import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import { submitPublicOpenPlayRegistrationPaymentProofAction } from "@/actions/public-open-play-registration-payment-proof.actions";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-open-play-registration.actions", () => ({
  createPublicOpenPlayRegistrationAction: jest.fn(),
}));
jest.mock("@/actions/public-open-play-registration-payment-proof.actions", () => ({
  submitPublicOpenPlayRegistrationPaymentProofAction: jest.fn(),
}));
jest.mock("@/actions/public-open-play-registration-cancellation.actions", () => ({
  cancelPublicOpenPlayRegistrationAction: jest.fn(),
}));

const mockedCreate = createPublicOpenPlayRegistrationAction as jest.MockedFunction<
  typeof createPublicOpenPlayRegistrationAction
>;
const mockedSubmitProof = submitPublicOpenPlayRegistrationPaymentProofAction as jest.MockedFunction<
  typeof submitPublicOpenPlayRegistrationPaymentProofAction
>;
const mockedCancelRegistration = cancelPublicOpenPlayRegistrationAction as jest.MockedFunction<
  typeof cancelPublicOpenPlayRegistrationAction
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

function renderForm() {
  render(
    <PublicOpenPlayRegistrationForm
      nights={nights}
      registrationFeeCents={15000}
      gcashInfo={gcashInfo}
      contactPhone="09171234567"
      contactFacebookUrl="https://facebook.com/thecourtroom"
      waitlistedMessage="We'll get in touch if a slot opens up, and you can pay then."
    />,
  );
}

// Reported live: staff kept finding AWAITING_PAYMENT registrations with
// no proof ever submitted — people clicked "Register," saw "Slot held,"
// and walked away thinking that was the whole process. Fix: the
// screenshot is now required in the SAME form/click as "Register," so
// there's no longer a step boundary to abandon at.
describe("PublicOpenPlayRegistrationForm — screenshot required to register", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("blocks submission and never calls the registration action when no screenshot is attached", async () => {
    renderForm();
    fillRequiredFields();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /register & submit payment/i }));
    });

    expect(
      screen.getByText("Please upload your payment screenshot to complete registration."),
    ).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("creates the hold and submits the proof in one click when a screenshot is attached", async () => {
    mockedCreate.mockResolvedValue({
      error: null,
      status: "registered",
      registrationId: "reg-1",
      holdExpiresAt: null,
    });
    mockedSubmitProof.mockResolvedValue({ error: null, proofId: "proof-1" });

    renderForm();
    fillRequiredFields();

    const fileInput = document.getElementById("screenshot") as HTMLInputElement;
    const file = new File(["x"], "gcash-receipt.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /register & submit payment/i }));
    });

    await waitFor(() =>
      expect(mockedSubmitProof).toHaveBeenCalledWith(
        expect.objectContaining({ registrationId: "reg-1", submittedAmountCents: 15000 }),
      ),
    );
    expect(screen.getByText("Payment submitted")).toBeInTheDocument();
  });

  // Owner request (2026-08-06): "the registration shouldn't push through
  // if no proof of payment is received" — same fix already shipped for
  // bookings, applied here after a live customer report of "cannot
  // upload payment receipt." This test used to assert the OPPOSITE
  // (hold kept alive, customer falls back to a manual retry screen). A
  // failed upload now cancels the just-created hold (releasing the
  // seat) and returns to the plain registration form instead.
  it("cancels the just-created hold and returns to the registration form, not the retry screen, when the proof upload fails", async () => {
    mockedCreate.mockResolvedValue({
      error: null,
      status: "registered",
      registrationId: "reg-1",
      holdExpiresAt: null,
    });
    mockedSubmitProof.mockResolvedValue({ error: "Upload service unavailable." });
    mockedCancelRegistration.mockResolvedValue({ error: null });

    renderForm();
    fillRequiredFields();

    const fileInput = document.getElementById("screenshot") as HTMLInputElement;
    const file = new File(["x"], "gcash-receipt.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /register & submit payment/i }));
    });

    await waitFor(() =>
      expect(mockedCancelRegistration).toHaveBeenCalledWith({
        registrationId: "reg-1",
        phone: "09171234567",
      }),
    );
    expect(screen.queryByText(/Slot held/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Payment submitted")).not.toBeInTheDocument();
    // Back on the real form, not the retry screen for a hold that no
    // longer exists.
    expect(screen.getByRole("button", { name: /register & submit payment/i })).toBeInTheDocument();
  });
});

// Owner request (2026-08-07): the GCash QR/payment panel used to render
// unconditionally regardless of the selected date's capacity, so a
// customer picking an already-full night still saw "send payment now."
// The full/not-full check must react to the customer CHANGING the
// selected date in the picker, not only to whatever date the form
// happened to default to at mount — that's the specific regression risk
// this test targets, since a value read once at mount would look correct
// on first render and only break the moment someone actually changes the
// dropdown.
describe("PublicOpenPlayRegistrationForm — full/not-full state reacts live to changing the selected date", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hides the GCash QR/payment fields and switches the button to 'Join waitlist' the instant the customer picks a FULL night", async () => {
    const openAndFullNights = [
      { date: "2026-08-01", label: "Fri, Aug 1", remainingSeats: 5 },
      { date: "2026-08-02", label: "Sat, Aug 2", remainingSeats: 0 },
    ];

    render(
      <PublicOpenPlayRegistrationForm
        nights={openAndFullNights}
        registrationFeeCents={15000}
        gcashInfo={gcashInfo}
        contactPhone="09171234567"
        contactFacebookUrl="https://facebook.com/thecourtroom"
        waitlistedMessage="We'll get in touch if a slot opens up, and you can pay then."
      />,
    );

    // Defaults to the first (open) night — payment fields visible, normal
    // "Register & submit payment" button.
    expect(screen.getByText("Pay via GCash to complete your registration")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register & submit payment/i })).toBeInTheDocument();

    await clickAsync(screen.getByRole("combobox", { name: /night/i }));
    await selectOptionAsync(await screen.findByRole("option", { name: /sat, aug 2/i }));

    expect(screen.queryByText("Pay via GCash to complete your registration")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Payment screenshot (required)")).not.toBeInTheDocument();
    expect(screen.getByText("This night is full.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /join waitlist/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /register & submit payment/i })).not.toBeInTheDocument();
  });
});
