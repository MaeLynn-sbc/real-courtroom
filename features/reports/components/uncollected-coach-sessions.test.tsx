import { act, fireEvent, render, screen } from "@testing-library/react";

import { UncollectedCoachSessions } from "./uncollected-coach-sessions";
import { markCoachSessionCollectedAction } from "@/actions/coaching.actions";

jest.mock("@/actions/coaching.actions", () => ({
  markCoachSessionCollectedAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedMarkCollected = markCoachSessionCollectedAction as jest.MockedFunction<
  typeof markCoachSessionCollectedAction
>;

const paymentMethods = [
  { id: "pm-cash", key: "CASH" as const, label: "Cash" },
  { id: "pm-gcash", key: "GCASH" as const, label: "GCash" },
];

const sessions = [
  {
    id: "session-1",
    sessionReference: "CS-20260809-0001",
    playerName: "Test Player",
    bookingReference: "BK-20260809-0001",
    startAt: new Date(2026, 7, 9, 10, 0).toISOString(),
    rateCents: 60000,
  },
];

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// Owner request (2026-08-09), root-cause-consistent with the settlement
// picker (2026-08-08): no default payment method, "Mark collected" stays
// disabled until one is chosen, and the confirmation echo reflects
// whichever was actually picked.
describe("UncollectedCoachSessions — no default selection, blocked until chosen", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders nothing when there are no uncollected sessions", () => {
    const { container } = render(<UncollectedCoachSessions sessions={[]} paymentMethods={paymentMethods} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("neither payment button starts selected, and Mark collected starts disabled", () => {
    render(<UncollectedCoachSessions sessions={sessions} paymentMethods={paymentMethods} />);
    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "GCash" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /mark collected/i })).toBeDisabled();
    expect(screen.queryByText(/marking/i)).not.toBeInTheDocument();
  });

  it("choosing Cash enables Mark collected and echoes the choice, then submits with the session's own fee", async () => {
    mockedMarkCollected.mockResolvedValue({ error: null });
    render(<UncollectedCoachSessions sessions={sessions} paymentMethods={paymentMethods} />);

    await clickAsync(screen.getByRole("button", { name: "Cash" }));
    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/marking.*as cash/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark collected/i })).toBeEnabled();

    await clickAsync(screen.getByRole("button", { name: /mark collected/i }));

    expect(mockedMarkCollected).toHaveBeenCalledWith({
      coachSessionId: "session-1",
      paymentMethodId: "pm-cash",
    });
  });

  it("switching the choice on the same row updates aria-pressed on both buttons", async () => {
    render(<UncollectedCoachSessions sessions={sessions} paymentMethods={paymentMethods} />);

    await clickAsync(screen.getByRole("button", { name: "Cash" }));
    await clickAsync(screen.getByRole("button", { name: "GCash" }));

    expect(screen.getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "GCash" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/marking.*as gcash/i)).toBeInTheDocument();
  });
});
