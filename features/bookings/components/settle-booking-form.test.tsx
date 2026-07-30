import { act, fireEvent, render, screen } from "@testing-library/react";

import { SettleBookingForm } from "./settle-booking-form";
import { settleBookingAction } from "@/actions/booking.actions";

jest.mock("@/actions/booking.actions", () => ({
  settleBookingAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

const mockedSettleBookingAction = settleBookingAction as jest.MockedFunction<typeof settleBookingAction>;

const paymentMethods = [
  { id: "pm-cash", key: "CASH" as const, label: "Cash" },
  { id: "pm-gcash", key: "GCASH" as const, label: "GCash" },
];

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

// Was two dropdowns ("Paid via" + "Payment method") asking the same
// question — collapsed to one, with settledVia's CASH/GCASH value now
// derived from the selected PaymentMethod row's key rather than asked
// for separately. These prove the single control actually drives the
// derived value the settle action receives, not just that it renders.
describe("SettleBookingForm — single payment control, derived method", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders exactly one payment-method control, defaulting to the first option", () => {
    render(<SettleBookingForm bookingId="booking-1" amountCents={75000} paymentMethods={paymentMethods} />);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.getByText("Cash")).toBeInTheDocument();
  });

  it("submits with method derived from the selected Cash row, no separate 'Paid via' field", async () => {
    mockedSettleBookingAction.mockResolvedValue({ error: null });
    render(<SettleBookingForm bookingId="booking-1" amountCents={75000} paymentMethods={paymentMethods} />);

    await clickAsync(screen.getByRole("button", { name: /confirm/i }));

    expect(mockedSettleBookingAction).toHaveBeenCalledWith({
      bookingId: "booking-1",
      method: "CASH",
      gcashReference: undefined,
      paymentMethodId: "pm-cash",
    });
  });

  it("switching to GCash reveals the reference field and derives method GCASH", async () => {
    mockedSettleBookingAction.mockResolvedValue({ error: null });
    render(<SettleBookingForm bookingId="booking-1" amountCents={75000} paymentMethods={paymentMethods} />);

    expect(screen.queryByLabelText(/gcash reference/i)).not.toBeInTheDocument();

    await clickAsync(screen.getByRole("combobox"));
    await selectOptionAsync(await screen.findByRole("option", { name: "GCash" }));

    expect(screen.getByLabelText(/gcash reference/i)).toBeInTheDocument();

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
    });
  });
});
