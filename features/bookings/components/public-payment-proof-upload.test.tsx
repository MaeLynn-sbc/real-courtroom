import { act, fireEvent, render, screen } from "@testing-library/react";

import { PublicPaymentProofUpload } from "./public-payment-proof-upload";
import type { GcashPaymentInfo } from "@/features/cms/schemas/cms.schema";

jest.mock("@/actions/public-booking-payment-proof.actions", () => ({
  submitPublicBookingPaymentProofAction: jest.fn(),
}));

const gcashInfo: GcashPaymentInfo = {
  qrImageUrl: null,
  accountName: "The Courtroom",
  accountNumber: "0917 000 0000",
};

// Reported live: the "Choose File" button text was nearly invisible
// (native ::file-selector-button chrome fighting file:text-foreground),
// and the placeholder read "Upload proof of payment" instead of matching
// what the customer is actually holding — a GCash screenshot.
describe("PublicPaymentProofUpload — screenshot field copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows the new placeholder before a file is chosen, and the filename after", async () => {
    render(
      <PublicPaymentProofUpload bookingId="b1" amountDueCents={35000} gcashInfo={gcashInfo} />,
    );

    expect(screen.getByText("Upload payment screenshot")).toBeInTheDocument();
    expect(screen.queryByText("Upload proof of payment")).not.toBeInTheDocument();

    const fileInput = document.getElementById("publicScreenshot") as HTMLInputElement;
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
// record one manually at verification (payment-verification-detail.tsx).
describe("PublicPaymentProofUpload — GCash reference field removed", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does not render a GCash reference field", () => {
    render(
      <PublicPaymentProofUpload bookingId="b1" amountDueCents={35000} gcashInfo={gcashInfo} />,
    );

    expect(screen.queryByText(/gcash reference/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/gcash reference/i)).not.toBeInTheDocument();
  });
});
