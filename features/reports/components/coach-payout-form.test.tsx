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

// Owner report (2026-08-27): "i selected the previous week but what
// appears is this week. i want to pay the previous week."
//
// Switching week tabs is a soft navigation, so React reuses this
// component instance and merely updates its props. amount and description
// are seeded with useState, whose argument is only the INITIAL value — so
// the form kept showing the previously-viewed week. The owner was one
// click from paying this week's amount, labelled as this week, while
// looking at last week's report.
//
// The fix is a key in coaching-weekly-report.tsx. These two cases pin the
// behaviour that made the key necessary, so nobody removes it as noise.
describe("CoachPayoutForm — week switching", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  function renderAt(weekLabel: string, amountCents: number, key?: string) {
    return render(
      <CoachPayoutForm
        key={key}
        coachName="Coach Dhudz"
        defaultAmountCents={amountCents}
        categoryId="cat-coach"
        paymentMethods={paymentMethods}
        weekLabel={weekLabel}
      />,
    );
  }

  it("WITHOUT a changing key, new props do NOT refresh the fields — the bug", async () => {
    const { rerender } = renderAt("Aug 23 – Aug 29, 2026", 280000);
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));

    rerender(
      <CoachPayoutForm
        coachName="Coach Dhudz"
        defaultAmountCents={480000}
        categoryId="cat-coach"
        paymentMethods={paymentMethods}
        weekLabel="Aug 16 – Aug 22, 2026"
      />,
    );

    // Still the FIRST week's figures, which is precisely what the owner saw.
    expect(screen.getByDisplayValue("2800.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Aug 23 – Aug 29, 2026/)).toBeInTheDocument();
  });

  it("WITH a key per week, the fields follow the selected week", async () => {
    const { rerender } = renderAt("Aug 23 – Aug 29, 2026", 280000, "coach-2026-08-23");
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));

    rerender(
      <CoachPayoutForm
        key="coach-2026-08-16"
        coachName="Coach Dhudz"
        defaultAmountCents={480000}
        categoryId="cat-coach"
        paymentMethods={paymentMethods}
        weekLabel="Aug 16 – Aug 22, 2026"
      />,
    );

    // Remounted, so it collapses back to the button and reseeds from props.
    await clickAsync(screen.getByRole("button", { name: /pay coach/i }));
    expect(screen.getByDisplayValue("4800.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Aug 16 – Aug 22, 2026/)).toBeInTheDocument();
  });
});
