import { act, fireEvent, render, screen } from "@testing-library/react";

import { OpenPlayRegistrationProofForm } from "./open-play-registration-proof-form";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-open-play-registration-payment-proof.actions", () => ({
  submitPublicOpenPlayRegistrationPaymentProofAction: jest.fn(),
}));

const gcashInfo: GcashPaymentInfo = { qrImageUrl: null, accountName: "The Courtroom", accountNumber: "0917 000 0000" };

// Reported live: this screen's screenshot field used the raw native file
// input, whose "Choose File" button relies on file:text-foreground over
// file:bg-transparent — many browsers keep the button's own native
// (light) chrome regardless, so text tuned for a dark page background
// nearly disappeared. Now uses the same hidden-input + styled-label
// pattern (and copy) as public-payment-proof-upload.tsx.
describe("OpenPlayRegistrationProofForm — screenshot field copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the new placeholder before a file is chosen, and the filename after", async () => {
    render(
      <OpenPlayRegistrationProofForm
        registrationId="reg-1"
        expectedAmountCents={15000}
        gcashInfo={gcashInfo}
        contactPhone="09171234567"
        contactFacebookUrl="https://facebook.com/thecourtroom"
        onSubmitted={() => {}}
      />,
    );

    expect(screen.getByText("Upload payment screenshot")).toBeInTheDocument();

    const fileInput = document.getElementById("proofScreenshot") as HTMLInputElement;
    const file = new File(["x"], "gcash-receipt.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    expect(screen.getByText("gcash-receipt.png")).toBeInTheDocument();
    expect(screen.queryByText("Upload payment screenshot")).not.toBeInTheDocument();
  });
});

// Removed entirely per the user's ask: the screenshot is sufficient proof,
// and retyping a reference from one app into another is friction at
// exactly the moment a customer is trying to finish. Staff can still
// record one manually at verification
// (open-play-payment-verification-detail.tsx).
describe("OpenPlayRegistrationProofForm — GCash reference field removed", () => {
  it("does not render a GCash reference field", () => {
    render(
      <OpenPlayRegistrationProofForm
        registrationId="reg-1"
        expectedAmountCents={15000}
        gcashInfo={gcashInfo}
        contactPhone="09171234567"
        contactFacebookUrl="https://facebook.com/thecourtroom"
        onSubmitted={() => {}}
      />,
    );

    expect(screen.queryByText(/gcash reference/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/gcash reference/i)).not.toBeInTheDocument();
  });
});
