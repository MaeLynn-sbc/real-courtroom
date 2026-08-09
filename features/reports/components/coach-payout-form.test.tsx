import { act, fireEvent, render, screen } from "@testing-library/react";

import { CoachPayoutForm } from "./coach-payout-form";
import { createExpenseAction } from "@/actions/expense.actions";

jest.mock("@/actions/expense.actions", () => ({
  createExpenseAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedCreateExpense = createExpenseAction as jest.MockedFunction<typeof createExpenseAction>;

const paymentMethods = [
  { id: "pm-cash", key: "CASH" as const, label: "Cash" },
  { id: "pm-gcash", key: "GCASH" as const, label: "GCash" },
];

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Owner request (2026-08-09): a coach collects their fee directly — the
// owner pays them out afterward, and this form records that OUTFLOW as a
// real Expense (reduces Cash/GCash). Root-cause discipline reused from
// the settlement/coaching pickers: no default payment method, Confirm
// blocked until one is chosen.
describe("CoachPayoutForm — records an outgoing payout, not incoming revenue", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("starts collapsed behind a 'Pay coach' button", () => {
    render(
      <CoachPayoutForm
        coachName="Coach Dhudz"
        defaultAmountCents={560000}
        categoryId="cat-coach-payouts"
        paymentMethods={paymentMethods}
        weekLabel="Aug 2 – Aug 8, 2026"
      />,
    );
    expect(screen.getByRole("button", { name: /pay coach/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm payout/i })).not.toBeInTheDocument();
  });

  it("opens with the collected total prefilled, no payment method selected, and Confirm disabled", async () => {
    render(
      <CoachPayoutForm
        coachName="Coach Dhudz"
        defaultAmountCents={560000}
        categoryId="cat-coach-payouts"
        paymentMethods={paymentMethods}
        weekLabel="Aug 2 – Aug 8, 2026"
      />,
    );
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));

    expect(screen.getByLabelText(/amount/i)).toHaveValue(5600);
    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "GCash" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /confirm payout/i })).toBeDisabled();
  });

  it("submits an Expense with the chosen amount, date, description, and payment method — not a Sale", async () => {
    mockedCreateExpense.mockResolvedValue({ error: null });
    render(
      <CoachPayoutForm
        coachName="Coach Dhudz"
        defaultAmountCents={560000}
        categoryId="cat-coach-payouts"
        paymentMethods={paymentMethods}
        weekLabel="Aug 2 – Aug 8, 2026"
      />,
    );
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "3000" } });
    await clickAsync(screen.getByRole("button", { name: "GCash" }));
    expect(screen.getByText(/paying.*out of gcash/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm payout/i })).toBeEnabled();

    await clickAsync(screen.getByRole("button", { name: /confirm payout/i }));

    expect(mockedCreateExpense).toHaveBeenCalledWith(
      expect.objectContaining({
        amountCents: 300000,
        categoryId: "cat-coach-payouts",
        paymentMethodId: "pm-gcash",
        description: expect.stringContaining("Coach Dhudz"),
      }),
    );
  });

  it("warns instead of submitting when no Coach Payouts category exists yet", async () => {
    render(
      <CoachPayoutForm
        coachName="Coach Dhudz"
        defaultAmountCents={560000}
        categoryId={undefined}
        paymentMethods={paymentMethods}
        weekLabel="Aug 2 – Aug 8, 2026"
      />,
    );
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));
    await clickAsync(screen.getByRole("button", { name: "Cash" }));
    await clickAsync(screen.getByRole("button", { name: /confirm payout/i }));

    expect(mockedCreateExpense).not.toHaveBeenCalled();
  });
});
