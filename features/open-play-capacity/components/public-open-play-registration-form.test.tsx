import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { PublicOpenPlayRegistrationForm } from "./public-open-play-registration-form";
import { createPublicOpenPlayRegistrationAction } from "@/actions/public-open-play-registration.actions";
import { submitPublicOpenPlayRegistrationPaymentProofAction } from "@/actions/public-open-play-registration-payment-proof.actions";
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
const mockedSubmitProof = submitPublicOpenPlayRegistrationPaymentProofAction as jest.MockedFunction<
  typeof submitPublicOpenPlayRegistrationPaymentProofAction
>;

const gcashInfo: GcashPaymentInfo = { qrImageUrl: null, accountName: "The Courtroom", accountNumber: "0917 000 0000" };
const nights = [{ date: "2026-08-01", label: "Fri, Aug 1" }];

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

    expect(screen.getByText("Please upload your payment screenshot to complete registration.")).toBeInTheDocument();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("creates the hold and submits the proof in one click when a screenshot is attached", async () => {
    mockedCreate.mockResolvedValue({ error: null, status: "registered", registrationId: "reg-1", holdExpiresAt: null });
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

    await waitFor(() => expect(mockedSubmitProof).toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: "reg-1", submittedAmountCents: 15000 }),
    ));
    expect(screen.getByText("Payment submitted")).toBeInTheDocument();
  });

  it("falls back to the manual retry screen, without losing the hold, if the proof upload itself fails", async () => {
    mockedCreate.mockResolvedValue({ error: null, status: "registered", registrationId: "reg-1", holdExpiresAt: null });
    mockedSubmitProof.mockResolvedValue({ error: "Upload service unavailable." });

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

    await waitFor(() => expect(screen.getByText(/Slot held/i)).toBeInTheDocument());
    expect(screen.getByText(/We saved your slot, but the screenshot upload failed/)).toBeInTheDocument();
  });
});
