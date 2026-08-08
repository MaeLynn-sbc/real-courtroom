import { act, fireEvent, render, screen } from "@testing-library/react";

import { SettleBookingForm } from "./settle-booking-form";
import { settleBookingAction } from "@/actions/booking.actions";

jest.mock("@/actions/booking.actions", () => ({
  settleBookingAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const mockedSettleBookingAction = settleBookingAction as jest.MockedFunction<
  typeof settleBookingAction
>;

const paymentMethods = [
  { id: "pm-cash", key: "CASH" as const, label: "Cash" },
  { id: "pm-gcash", key: "GCASH" as const, label: "GCash" },
];

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Owner request (2026-08-08), root-cause fix for attendants recording a
// Cash payment as GCash (or the reverse): the dropdown that silently
// defaulted to Cash is gone — two equal buttons, neither selected until
// tapped, and Confirm stays disabled until one is. These prove the new
// control actually drives the derived value the settle action receives
// (not just that it renders), that nothing is pre-selected, and that the
// confirmation echo reflects whichever was actually chosen.
describe("SettleBookingForm — two-button payment picker, no default selection", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders both Cash and GCash buttons with neither selected, and Confirm disabled", () => {
    render(
      <SettleBookingForm
        bookingId="booking-1"
        amountCents={75000}
        paymentMethods={paymentMethods}
      />,
    );
    const cashButton = screen.getByRole("button", { name: "Cash" });
    const gcashButton = screen.getByRole("button", { name: "GCash" });
    expect(cashButton).toHaveAttribute("aria-pressed", "false");
    expect(gcashButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /confirm/i })).toBeDisabled();
    expect(screen.queryByText(/settling/i)).not.toBeInTheDocument();
  });

  it("submits with method derived from clicking Cash, and echoes the choice before commit", async () => {
    mockedSettleBookingAction.mockResolvedValue({ error: null });
    render(
      <SettleBookingForm
        bookingId="booking-1"
        amountCents={75000}
        paymentMethods={paymentMethods}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: "Cash" }));
    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/settling.*as cash/i)).toBeInTheDocument();

    await clickAsync(screen.getByRole("button", { name: /confirm/i }));

    expect(mockedSettleBookingAction).toHaveBeenCalledWith({
      bookingId: "booking-1",
      method: "CASH",
      gcashReference: undefined,
      paymentMethodId: "pm-cash",
      receipt: undefined,
    });
  });

  it("clicking GCash reveals the reference field, blocks submit until it's filled, and derives method GCASH", async () => {
    mockedSettleBookingAction.mockResolvedValue({ error: null });
    render(
      <SettleBookingForm
        bookingId="booking-1"
        amountCents={75000}
        paymentMethods={paymentMethods}
      />,
    );

    expect(screen.queryByLabelText(/gcash reference/i)).not.toBeInTheDocument();

    await clickAsync(screen.getByRole("button", { name: "GCash" }));

    expect(screen.getByLabelText(/gcash reference/i)).toBeInTheDocument();
    expect(screen.getByText(/settling.*as gcash/i)).toBeInTheDocument();
    // Confirm is enabled the moment a method is chosen — the reference
    // requirement is checked on submit, not by disabling the button.
    expect(screen.getByRole("button", { name: /confirm/i })).toBeEnabled();

    await clickAsync(screen.getByRole("button", { name: /confirm/i }));
    expect(screen.getByText(/enter a gcash reference/i)).toBeInTheDocument();
    expect(mockedSettleBookingAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/gcash reference/i), { target: { value: "REF123" } });
    await clickAsync(screen.getByRole("button", { name: /confirm/i }));

    expect(mockedSettleBookingAction).toHaveBeenCalledWith({
      bookingId: "booking-1",
      method: "GCASH",
      gcashReference: "REF123",
      paymentMethodId: "pm-gcash",
      receipt: undefined,
    });
  });
});
