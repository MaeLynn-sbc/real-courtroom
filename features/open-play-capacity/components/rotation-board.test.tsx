import { act, fireEvent, render, screen } from "@testing-library/react";

import { RotationBoard, type RotationBoardProps } from "./rotation-board";
import { announceAssignmentAction, confirmAssignmentAction } from "@/actions/open-play-rotation.actions";

jest.mock("@/actions/open-play-rotation.actions", () => ({
  announceAssignmentAction: jest.fn(),
  cancelAssignmentAction: jest.fn(),
  completeAssignmentAction: jest.fn(),
  confirmAssignmentAction: jest.fn(),
  createManualAssignmentAction: jest.fn(),
  markDoneAction: jest.fn(),
  markRestingAction: jest.fn(),
  markWaitingAgainAction: jest.fn(),
  proposeAssignmentAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedAnnounce = announceAssignmentAction as jest.MockedFunction<typeof announceAssignmentAction>;
const mockedConfirm = confirmAssignmentAction as jest.MockedFunction<typeof confirmAssignmentAction>;

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

function baseProps(overrides: Partial<RotationBoardProps["courts"][number]>): RotationBoardProps {
  return {
    date: "2026-08-01",
    waiting: [],
    resting: [],
    maxWaitMinutes: 20,
    unfillableQueueReason: null,
    courts: [
      {
        id: "court-1",
        name: "Court 1",
        active: null,
        proposed: null,
        ...overrides,
      },
    ],
  };
}

// Manual timer/announce: staff now press ANNOUNCE and Start Timer as two
// separate actions instead of one bundled "Confirm" — proves each button
// calls its own distinct action, and that a proposed assignment sitting
// past the nudge threshold shows the "waiting to start" banner.
describe("RotationBoard — manual announce/start timer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls announceAssignmentAction, not confirmAssignmentAction, when Announce is pressed on a proposed group", async () => {
    mockedAnnounce.mockResolvedValue({ error: null });

    render(
      <RotationBoard
        {...baseProps({
          proposed: {
            id: "assignment-1",
            source: "AUTO",
            status: "PROPOSED",
            skillSpread: 0,
            startedAt: null,
            announcementRequestedAt: null,
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: /^announce$/i }));

    expect(mockedAnnounce).toHaveBeenCalledWith({ assignmentId: "assignment-1" });
    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("calls confirmAssignmentAction when Start timer is pressed, independently of Announce", async () => {
    mockedConfirm.mockResolvedValue({ error: null });

    render(
      <RotationBoard
        {...baseProps({
          proposed: {
            id: "assignment-1",
            source: "AUTO",
            status: "PROPOSED",
            skillSpread: 0,
            startedAt: null,
            announcementRequestedAt: "2026-08-01T00:00:00.000Z",
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: /start timer/i }));

    expect(mockedConfirm).toHaveBeenCalledWith({ assignmentId: "assignment-1" });
    expect(mockedAnnounce).not.toHaveBeenCalled();
  });

  it("shows the waiting-to-start banner once a proposed group is past the nudge threshold", () => {
    render(
      <RotationBoard
        {...baseProps({
          proposed: {
            id: "assignment-1",
            source: "AUTO",
            status: "PROPOSED",
            skillSpread: 0,
            startedAt: null,
            announcementRequestedAt: null,
            waitingToStart: true,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    expect(screen.getByText(/waiting to start/i)).toBeInTheDocument();
  });

  it("does not show the waiting-to-start banner for a freshly proposed group", () => {
    render(
      <RotationBoard
        {...baseProps({
          proposed: {
            id: "assignment-1",
            source: "AUTO",
            status: "PROPOSED",
            skillSpread: 0,
            startedAt: null,
            announcementRequestedAt: null,
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    expect(screen.queryByText(/waiting to start/i)).not.toBeInTheDocument();
  });

  it("also offers Announce (re-announce) on an already-active game, separate from Complete/Cancel", async () => {
    mockedAnnounce.mockResolvedValue({ error: null });

    render(
      <RotationBoard
        {...baseProps({
          active: {
            id: "assignment-2",
            source: "AUTO",
            status: "ACTIVE",
            skillSpread: 0,
            startedAt: "2026-08-01T00:00:00.000Z",
            announcementRequestedAt: "2026-08-01T00:00:00.000Z",
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: /^announce$/i }));

    expect(mockedAnnounce).toHaveBeenCalledWith({ assignmentId: "assignment-2" });
  });
});
