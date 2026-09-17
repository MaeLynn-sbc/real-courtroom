import { act, fireEvent, render, screen } from "@testing-library/react";

import { CheckInPanel } from "./checkin-panel";
import { checkInAction } from "@/actions/open-play-checkin.actions";

jest.mock("@/actions/open-play-checkin.actions", () => ({
  checkInAction: jest.fn(),
  undoCheckInAction: jest.fn(),
}));
jest.mock("@/actions/open-play-registration.actions", () => ({
  markNoShowAction: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedCheckIn = checkInAction as jest.MockedFunction<typeof checkInAction>;

const expected = [
  {
    id: "reg-1",
    playerName: "Jane",
    phone: "09219846122",
    skillLevel: "BEGINNER" as const,
    partyId: null,
    checkedInAt: null,
    sessionId: null,
  },
];

// Reported live: "Tap to check in" was a Badge sitting OUTSIDE the actual
// clickable button — only the name/phone text next to it was wired to
// check in. Tapping exactly where it said to tap did nothing. Proves the
// badge itself now triggers check-in, not just the name text beside it.
describe("CheckInPanel — tapping the 'Tap to check in' badge itself works", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("checks in when the badge text is clicked directly, not just the name", async () => {
    mockedCheckIn.mockResolvedValue({ error: null });
    render(<CheckInPanel expected={expected} checkedIn={[]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Tap to check in"));
    });

    expect(mockedCheckIn).toHaveBeenCalledWith({ registrationId: "reg-1" });
  });

  it("still checks in when the name/phone text is clicked", async () => {
    mockedCheckIn.mockResolvedValue({ error: null });
    render(<CheckInPanel expected={expected} checkedIn={[]} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Jane"));
    });

    expect(mockedCheckIn).toHaveBeenCalledWith({ registrationId: "reg-1" });
  });
});

// Owner (2026-09-17): the Checked in list is one button until clicked.
describe("CheckInPanel — collapsible Checked in list", () => {
  const arrived = {
    id: "reg-arrived",
    playerName: "Arrived Ana",
    phone: "1",
    skillLevel: "NOVICE" as const,
    status: "CONFIRMED",
    checkedInAt: new Date(2026, 8, 17, 17, 15).toISOString(),
    sessionId: null,
  };

  it("shows only the count until opened, then lists arrivals, and closes again", () => {
    render(<CheckInPanel expected={[]} checkedIn={[arrived] as never} />);
    const toggle = screen.getByRole("button", { name: /checked in \(1\)/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Arrived Ana")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Arrived Ana")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Arrived Ana")).not.toBeInTheDocument();
  });
});
