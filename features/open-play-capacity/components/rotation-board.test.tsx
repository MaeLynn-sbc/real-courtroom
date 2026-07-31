import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { RotationBoard, type RotationBoardProps } from "./rotation-board";
import {
  announceAssignmentAction,
  confirmAssignmentAction,
  moveQueueUnitAfterAction,
  swapPartyMemberAction,
} from "@/actions/open-play-rotation.actions";

jest.mock("@/actions/open-play-rotation.actions", () => ({
  announceAssignmentAction: jest.fn(),
  cancelAssignmentAction: jest.fn(),
  completeAssignmentAction: jest.fn(),
  confirmAssignmentAction: jest.fn(),
  createManualAssignmentAction: jest.fn(),
  markDoneAction: jest.fn(),
  markRestingAction: jest.fn(),
  markWaitingAgainAction: jest.fn(),
  moveQueueUnitAfterAction: jest.fn(),
  proposeAssignmentAction: jest.fn(),
  swapPartyMemberAction: jest.fn(),
}));

// "Next up" box's Cancel/Edit actions — mocked for the same reason as
// open-play-rotation.actions above: the real module pulls in next/cache,
// which the jsdom test environment can't execute.
jest.mock("@/actions/open-play-registration.actions", () => ({
  cancelRegistrationAction: jest.fn(),
  updateRegistrationDetailsAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedAnnounce = announceAssignmentAction as jest.MockedFunction<
  typeof announceAssignmentAction
>;
const mockedConfirm = confirmAssignmentAction as jest.MockedFunction<
  typeof confirmAssignmentAction
>;
const mockedMoveAfter = moveQueueUnitAfterAction as jest.MockedFunction<
  typeof moveQueueUnitAfterAction
>;
const mockedSwap = swapPartyMemberAction as jest.MockedFunction<typeof swapPartyMemberAction>;

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
            endAt: null,
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
            endAt: null,
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
            endAt: null,
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
            endAt: null,
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
            endAt: null,
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

// Queue reorder: staff move a whole unit to sit after a chosen, later
// player via a plain select + button (not drag-and-drop). Proves the
// action receives the mover's full member list and the chosen target,
// and that a party is offered/moved as one unit, never split.
describe("RotationBoard — queue reorder (Move after)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const waiting: RotationBoardProps["waiting"] = [
    {
      partyId: null,
      members: [
        {
          queueEntryId: "qe-1",
          registrationId: "r-alice",
          playerName: "Alice",
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: 5,
      pastMaxWait: false,
    },
    {
      partyId: "party-1",
      members: [
        {
          queueEntryId: "qe-2",
          registrationId: "r-ben",
          playerName: "Ben",
          skillLevel: "BEGINNER",
        },
        {
          queueEntryId: "qe-3",
          registrationId: "r-carla",
          playerName: "Carla",
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: 3,
      pastMaxWait: false,
    },
    {
      partyId: null,
      members: [
        {
          queueEntryId: "qe-4",
          registrationId: "r-dex",
          playerName: "Dex",
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: 1,
      pastMaxWait: false,
    },
  ];

  function renderBoard() {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={waiting}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: null, proposed: null }]}
      />,
    );
  }

  function findRow(label: string): HTMLElement {
    // Names also appear as <option> text inside every OTHER row's "Move
    // after" select — scope to the label (checkbox caption), not any
    // text match, to find this player's own waiting-list row.
    const match = screen.getAllByText(label).find((el) => el.closest("label"));
    if (!match) throw new Error(`No label found for "${label}"`);
    return match.closest("div.rounded-lg")!;
  }

  it("moves a solo unit after the chosen target, sending only that unit's registrationId", async () => {
    mockedMoveAfter.mockResolvedValue({ error: null });
    renderBoard();

    const aliceRow = findRow("Alice");
    const select = aliceRow.querySelector("select")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "r-dex" } });
    });
    await clickAsync(within(aliceRow).getByRole("button", { name: /^move$/i }));

    expect(mockedMoveAfter).toHaveBeenCalledWith({
      date: "2026-08-01",
      movingRegistrationIds: ["r-alice"],
      targetRegistrationId: "r-dex",
    });
  });

  it("moves a whole party together, never a single member", async () => {
    mockedMoveAfter.mockResolvedValue({ error: null });
    renderBoard();

    const benRow = findRow("Ben");
    const select = benRow.querySelector("select")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "r-dex" } });
    });
    await clickAsync(within(benRow).getByRole("button", { name: /^move$/i }));

    expect(mockedMoveAfter).toHaveBeenCalledWith({
      date: "2026-08-01",
      movingRegistrationIds: ["r-ben", "r-carla"],
      targetRegistrationId: "r-dex",
    });
  });

  it("does not offer a unit as a move target for itself", () => {
    renderBoard();

    const dexRow = findRow("Dex");
    const options = Array.from(dexRow.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).not.toContain("Dex");
    expect(options).toEqual(expect.arrayContaining(["Alice", "Ben & Carla"]));
  });
});

describe("RotationBoard — Next up preview (group swap)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const waiting: RotationBoardProps["waiting"] = [
    {
      partyId: null,
      members: [
        {
          queueEntryId: "qe-1",
          registrationId: "r-alice",
          playerName: "Alice",
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: 5,
      pastMaxWait: false,
    },
    {
      partyId: "party-1",
      members: [
        {
          queueEntryId: "qe-2",
          registrationId: "r-ben",
          playerName: "Ben",
          skillLevel: "BEGINNER",
        },
        {
          queueEntryId: "qe-3",
          registrationId: "r-carla",
          playerName: "Carla",
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: 3,
      pastMaxWait: false,
    },
  ];

  function renderBoard() {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={waiting}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: null, proposed: null }]}
      />,
    );
  }

  it("swaps the two selected players' groups once both are picked and Swap is pressed", async () => {
    mockedSwap.mockResolvedValue({ error: null });
    renderBoard();

    await clickAsync(screen.getByRole("button", { name: "Select Alice to swap groups" }));
    await clickAsync(screen.getByRole("button", { name: "Select Ben to swap groups" }));
    await clickAsync(screen.getByRole("button", { name: /^swap$/i }));

    expect(mockedSwap).toHaveBeenCalledWith({
      date: "2026-08-01",
      memberARegistrationId: "r-alice",
      memberBRegistrationId: "r-ben",
    });
  });

  it("caps the swap selection at 2 — picking a third player drops the first", async () => {
    renderBoard();

    await clickAsync(screen.getByRole("button", { name: "Select Alice to swap groups" }));
    await clickAsync(screen.getByRole("button", { name: "Select Ben to swap groups" }));
    await clickAsync(screen.getByRole("button", { name: "Select Carla to swap groups" }));

    expect(
      screen.queryByRole("button", { name: "Deselect Alice for swap" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect Ben for swap" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deselect Carla for swap" })).toBeInTheDocument();
  });
});
