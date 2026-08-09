import { act, fireEvent, render, screen } from "@testing-library/react";

import { OpenPlaySpecialDisplayClient } from "./open-play-special-display-client";
import { announceAssignmentAction, announceTimesUpAction } from "@/actions/open-play-rotation.actions";
import type { DisplayData } from "@/services/display/display.service";

jest.mock("@/actions/open-play-rotation.actions", () => ({
  announceAssignmentAction: jest.fn(),
  announceTimesUpAction: jest.fn(),
}));

const mockedAnnounce = announceAssignmentAction as jest.MockedFunction<typeof announceAssignmentAction>;
const mockedTimesUp = announceTimesUpAction as jest.MockedFunction<typeof announceTimesUpAction>;

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

function opPendingData(assignmentId: string): DisplayData {
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    targetGameMinutes: 15,
    courts: [
      {
        id: "court-1",
        name: "Court 1",
        state: "op-pending",
        players: [{ name: "Ana" }, { name: "Ben" }],
        proposedAt: "2026-08-09T00:00:00.000Z",
        nudgeAt: "2026-08-09T00:05:00.000Z",
        announcementRequestedAt: null,
        startAt: null,
        endAt: null,
        next: null,
        assignmentId,
      },
    ],
    queue: [],
    stagedGroups: [],
  };
}

function opActiveData(assignmentId: string): DisplayData {
  return {
    generatedAt: "2026-08-09T00:00:00.000Z",
    targetGameMinutes: 15,
    courts: [
      {
        id: "court-2",
        name: "Court 2",
        state: "op",
        players: [{ name: "Ana" }, { name: "Ben" }],
        startAt: "2026-08-09T00:00:00.000Z",
        endAt: "2026-08-09T00:15:00.000Z",
        announcementRequestedAt: null,
        timesUpRequestedAt: null,
        next: null,
        assignmentId,
      },
    ],
    queue: [],
    stagedGroups: [],
  };
}

const commonProps = {
  announcementRepeatCount: 1,
  timeUpFlashDurationSeconds: 30,
  announcementVoice: null,
  refreshIntervalSeconds: 10,
  gameWarningEnabled: false,
  gameWarningMinutes: 1,
  timesUpTemplate: "Reminder, {court}, your time is up!",
};

// Owner request (2026-08-09): "copy exact codes for the open play...
// with manual button for names" — then, in the same conversation:
// "it will only be used to call out the players and to call if the time
// is up." Proves both controls exist, are wired to the real
// assignmentId carried on the court (see display.service.ts's own
// comment on why that field exists), and call the same two actions the
// staff rotation board's own Announce/Time's up buttons already use.
describe("OpenPlaySpecialDisplayClient — manual Announce and Time's up buttons", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it("renders an Announce button for an op-pending court carrying an assignmentId", () => {
    render(<OpenPlaySpecialDisplayClient initialData={opPendingData("assignment-1")} {...commonProps} />);
    expect(screen.getByRole("button", { name: /^announce$/i })).toBeInTheDocument();
  });

  it("calls announceAssignmentAction with the court's own assignmentId when pressed", async () => {
    mockedAnnounce.mockResolvedValue({ error: null });
    render(<OpenPlaySpecialDisplayClient initialData={opPendingData("assignment-42")} {...commonProps} />);

    await clickAsync(screen.getByRole("button", { name: /^announce$/i }));

    expect(mockedAnnounce).toHaveBeenCalledWith({ assignmentId: "assignment-42" });
  });

  it("renders both Announce and Time's up for a running (op) game", () => {
    render(<OpenPlaySpecialDisplayClient initialData={opActiveData("assignment-2")} {...commonProps} />);
    expect(screen.getByRole("button", { name: /^announce$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /time's up/i })).toBeInTheDocument();
  });

  it("calls announceTimesUpAction with the court's own assignmentId when Time's up is pressed", async () => {
    mockedTimesUp.mockResolvedValue({ error: null });
    render(<OpenPlaySpecialDisplayClient initialData={opActiveData("assignment-99")} {...commonProps} />);

    await clickAsync(screen.getByRole("button", { name: /time's up/i }));

    expect(mockedTimesUp).toHaveBeenCalledWith({ assignmentId: "assignment-99" });
  });

  // op-pending has no running clock yet — nothing to call "time's up" on.
  it("does not render Time's up for an op-pending (not yet started) court", () => {
    render(<OpenPlaySpecialDisplayClient initialData={opPendingData("assignment-3")} {...commonProps} />);
    expect(screen.queryByRole("button", { name: /time's up/i })).not.toBeInTheDocument();
  });
});
