import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { RotationBoard, type RotationBoardProps } from "./rotation-board";
import {
  announceAssignmentAction,
  announceTimesUpAction,
  assignPendingGroupToCourtAction,
  confirmAssignmentAction,
  createManualAssignmentAction,
  moveQueueUnitAfterAction,
  swapPartyMemberAction,
} from "@/actions/open-play-rotation.actions";

jest.mock("@/actions/open-play-rotation.actions", () => ({
  announceAssignmentAction: jest.fn(),
  announceTimesUpAction: jest.fn(),
  assignPendingGroupToCourtAction: jest.fn(),
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

// "Next up" box's Cancel action — mocked for the same reason as
// open-play-rotation.actions above: the real module pulls in next/cache,
// which the jsdom test environment can't execute.
jest.mock("@/actions/open-play-registration.actions", () => ({
  cancelRegistrationAction: jest.fn(),
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
const mockedTimesUp = announceTimesUpAction as jest.MockedFunction<typeof announceTimesUpAction>;
const mockedCreateManual = createManualAssignmentAction as jest.MockedFunction<
  typeof createManualAssignmentAction
>;
const mockedAssignPending = assignPendingGroupToCourtAction as jest.MockedFunction<
  typeof assignPendingGroupToCourtAction
>;

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
            timesUpRequestedAt: null,
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
            timesUpRequestedAt: null,
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
            timesUpRequestedAt: null,
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
            timesUpRequestedAt: null,
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
            timesUpRequestedAt: null,
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: /^announce$/i }));

    expect(mockedAnnounce).toHaveBeenCalledWith({ assignmentId: "assignment-2" });
  });

  it("offers a re-pressable Time's up button on an active game, separate from Announce/Complete/Cancel", async () => {
    mockedTimesUp.mockResolvedValue({ error: null });

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
            announcementRequestedAt: null,
            timesUpRequestedAt: null,
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    await clickAsync(screen.getByRole("button", { name: /^time's up$/i }));
    expect(mockedTimesUp).toHaveBeenCalledWith({ assignmentId: "assignment-2" });

    // Re-pressable — a second press fires again, same as Announce.
    await clickAsync(screen.getByRole("button", { name: /^time's up$/i }));
    expect(mockedTimesUp).toHaveBeenCalledTimes(2);
  });

  it("does not offer Time's up on a proposed (not yet started) group", () => {
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
            timesUpRequestedAt: null,
            waitingToStart: false,
            participants: [{ registrationId: "r1", playerName: "Ana", skillLevel: "BEGINNER" }],
          },
        })}
      />,
    );

    expect(screen.queryByRole("button", { name: /time's up/i })).not.toBeInTheDocument();
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

// Reported live: early mornings only 2-3 people show up, and staff
// couldn't start a game at all — "Build a group by hand" required
// exactly 4 picks. Proves the Create group button now enables at 2, 3,
// or 4 picks (never 1 or 5+), and sends exactly the picked
// registrationIds.
describe("RotationBoard — build a group by hand (2-4 players)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const names = ["Alice", "Ben", "Carla", "Dex", "Eve"];
  const waiting: RotationBoardProps["waiting"] = names.map((name, i) => ({
    partyId: null,
    members: [
      {
        queueEntryId: `qe-${i}`,
        registrationId: `r-${name.toLowerCase()}`,
        playerName: name,
        skillLevel: "BEGINNER",
      },
    ],
    waitMinutes: i,
    pastMaxWait: false,
  }));

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

  function pickCheckbox(name: string) {
    const label = screen.getAllByText(name, { exact: false }).find((el) => el.closest("label"));
    if (!label) throw new Error(`No checkbox label found for "${name}"`);
    const input = label.closest("label")!.querySelector("input[type=checkbox]")!;
    return fireEvent.click(input);
  }

  it("stays disabled with only 1 player picked", () => {
    renderBoard();
    act(() => pickCheckbox("Alice"));

    expect(screen.getByRole("button", { name: /^create group$/i })).toBeDisabled();
  });

  it("enables at 2 players and sends exactly those registrationIds", async () => {
    mockedCreateManual.mockResolvedValue({ error: null });
    renderBoard();

    act(() => pickCheckbox("Alice"));
    act(() => pickCheckbox("Ben"));
    const button = screen.getByRole("button", { name: /^create group$/i });
    expect(button).not.toBeDisabled();

    await clickAsync(button);

    expect(mockedCreateManual).toHaveBeenCalledWith({
      date: "2026-08-01",
      courtId: "court-1",
      registrationIds: ["r-alice", "r-ben"],
    });
  });

  it("enables at 3 players", () => {
    renderBoard();
    act(() => pickCheckbox("Alice"));
    act(() => pickCheckbox("Ben"));
    act(() => pickCheckbox("Carla"));

    expect(screen.getByRole("button", { name: /^create group$/i })).not.toBeDisabled();
  });

  it("enables at 4 players but disables again at 5", () => {
    renderBoard();
    act(() => pickCheckbox("Alice"));
    act(() => pickCheckbox("Ben"));
    act(() => pickCheckbox("Carla"));
    act(() => pickCheckbox("Dex"));
    expect(screen.getByRole("button", { name: /^create group$/i })).not.toBeDisabled();

    act(() => pickCheckbox("Eve"));
    expect(screen.getByRole("button", { name: /^create group$/i })).toBeDisabled();
  });
});

// "Put the action where the group is" — court dropdown + Assign button on
// each pending group (Next up/After that/Then). Proves: only vacant courts
// (no active, no proposed) show up in the dropdown; assigning sends exactly
// that group's registrationIds; and an all-courts-busy state hides the
// control entirely rather than rendering an empty select.
describe("RotationBoard — assign pending group to court", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const fourWaiting: RotationBoardProps["waiting"] = ["Alice", "Ben", "Carla", "Dex"].map(
    (name, i) => ({
      partyId: null,
      members: [
        {
          queueEntryId: `qe-${i}`,
          registrationId: `r-${name.toLowerCase()}`,
          playerName: name,
          skillLevel: "BEGINNER",
        },
      ],
      waitMinutes: i,
      pastMaxWait: false,
    }),
  );

  const occupiedAssignment: RotationBoardProps["courts"][number]["active"] = {
    id: "assignment-occupied",
    source: "AUTO",
    status: "ACTIVE",
    skillSpread: 0,
    startedAt: "2026-08-01T00:00:00.000Z",
    endAt: null,
    announcementRequestedAt: null,
    timesUpRequestedAt: null,
    waitingToStart: false,
    participants: [],
  };

  function nextUpGroup(): HTMLElement {
    const label = screen.getByText("Next up", { selector: "p" });
    return label.closest("div.rounded-lg")!;
  }

  it("only lists vacant courts in the dropdown — active/proposed courts are absent, not disabled", () => {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={fourWaiting}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[
          { id: "court-1", name: "Court 1", active: null, proposed: null },
          { id: "court-2", name: "Court 2", active: occupiedAssignment, proposed: null },
          {
            id: "court-3",
            name: "Court 3",
            active: null,
            proposed: { ...occupiedAssignment, id: "assignment-proposed", status: "PROPOSED" },
          },
        ]}
      />,
    );

    const group = nextUpGroup();
    const select = within(group).getByRole("combobox");
    const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);

    expect(optionLabels).toContain("Court 1");
    expect(optionLabels).not.toContain("Court 2");
    expect(optionLabels).not.toContain("Court 3");
  });

  it("assigns the group's exact registrationIds to the chosen court", async () => {
    mockedAssignPending.mockResolvedValue({ error: null });

    render(
      <RotationBoard
        date="2026-08-01"
        waiting={fourWaiting}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: null, proposed: null }]}
      />,
    );

    const group = nextUpGroup();
    const select = within(group).getByRole("combobox");
    fireEvent.change(select, { target: { value: "court-1" } });
    await clickAsync(within(group).getByRole("button", { name: /^assign$/i }));

    expect(mockedAssignPending).toHaveBeenCalledWith({
      date: "2026-08-01",
      courtId: "court-1",
      registrationIds: ["r-alice", "r-ben", "r-carla", "r-dex"],
    });
  });

  it("hides the dropdown and shows a busy note when no court is vacant", () => {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={fourWaiting}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: occupiedAssignment, proposed: null }]}
      />,
    );

    const group = nextUpGroup();
    expect(within(group).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: /^assign$/i })).not.toBeInTheDocument();
    expect(within(group).getByText(/all courts are busy/i)).toBeInTheDocument();
  });
});

// Reported live: "Marc ." / "Paul ." — a bare trailing separator with no
// surname after it. Proves the rotation board strips it wherever a name
// renders, without touching a genuine last initial.
describe("RotationBoard — trailing-dot name display fix", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("strips a bare trailing ' .' from a pending group's chip", () => {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={[
          {
            partyId: null,
            members: [
              {
                queueEntryId: "qe-1",
                registrationId: "r-marc",
                playerName: "Marc .",
                skillLevel: "BEGINNER",
              },
            ],
            waitMinutes: 1,
            pastMaxWait: false,
          },
        ]}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: null, proposed: null }]}
      />,
    );

    expect(screen.getAllByText("Marc").length).toBeGreaterThan(0);
    expect(screen.queryByText("Marc .")).not.toBeInTheDocument();
  });

  it("leaves a genuine last initial untouched", () => {
    render(
      <RotationBoard
        date="2026-08-01"
        waiting={[
          {
            partyId: null,
            members: [
              {
                queueEntryId: "qe-1",
                registrationId: "r-paul",
                playerName: "Paul C.",
                skillLevel: "BEGINNER",
              },
            ],
            waitMinutes: 1,
            pastMaxWait: false,
          },
        ]}
        resting={[]}
        maxWaitMinutes={20}
        unfillableQueueReason={null}
        courts={[{ id: "court-1", name: "Court 1", active: null, proposed: null }]}
      />,
    );

    expect(screen.getAllByText("Paul C.").length).toBeGreaterThan(0);
  });
});
