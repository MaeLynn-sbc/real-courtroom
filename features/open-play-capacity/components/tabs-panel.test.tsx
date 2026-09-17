import { act, fireEvent, render, screen } from "@testing-library/react";

import { TabsPanel } from "./tabs-panel";
import { updateRegistrationDetailsAction } from "@/actions/open-play-registration.actions";

jest.mock("@/actions/player-tab.actions", () => ({
  addAdjustmentAction: jest.fn(),
  addProductLineItemAction: jest.fn(),
  settleTabAction: jest.fn(),
  writeOffTabAction: jest.fn(),
}));

// Reported live: no way anywhere to fix a typo'd name short of
// cancelling and re-registering. Moved here from the Rotation Board's
// "Next up" preview per feedback that a preview box isn't the right
// place to edit names — this is.
jest.mock("@/actions/open-play-registration.actions", () => ({
  updateRegistrationDetailsAction: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedUpdateName = updateRegistrationDetailsAction as jest.MockedFunction<
  typeof updateRegistrationDetailsAction
>;

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

const tabs = [
  {
    id: "tab-1",
    registrationId: "reg-1",
    playerName: "Typo Namez",
    status: "OPEN" as const,
    totalCents: 15000,
    gamesPlayed: 2,
    settledVia: null,
  },
];

describe("TabsPanel — edit name", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("calls updateRegistrationDetailsAction with the tab's registrationId and the corrected name", async () => {
    mockedUpdateName.mockResolvedValue({ error: null });
    render(<TabsPanel tabs={tabs} paymentMethods={[]} products={[]} />);

    await clickAsync(screen.getByRole("button", { name: "Edit Typo Namez's name" }));

    const input = screen.getByPlaceholderText("Corrected name");
    fireEvent.change(input, { target: { value: "Typo Names" } });
    await clickAsync(screen.getByRole("button", { name: /^save name$/i }));

    expect(mockedUpdateName).toHaveBeenCalledWith({
      registrationId: "reg-1",
      playerName: "Typo Names",
    });
  });

  it("does not submit an empty name", async () => {
    render(<TabsPanel tabs={tabs} paymentMethods={[]} products={[]} />);

    await clickAsync(screen.getByRole("button", { name: "Edit Typo Namez's name" }));
    const input = screen.getByPlaceholderText("Corrected name");
    fireEvent.change(input, { target: { value: "   " } });
    await clickAsync(screen.getByRole("button", { name: /^save name$/i }));

    expect(mockedUpdateName).not.toHaveBeenCalled();
  });
});

// Owner (2026-09-17): "when the customer will settle tab, please make
// sure the details will appear — e.g. OP court 1 7:20-7:40pm", without
// losing the add-on button or the payment options.
describe("TabsPanel — itemised charges when settling", () => {
  const itemised = [
    {
      ...tabs[0],
      totalCents: 9000,
      items: [
        { id: "li-1", type: "GAME", description: "OP · Court 1 · 7:20 PM–7:40 PM", qty: 1, amountCents: 3500 },
        { id: "li-2", type: "GAME", description: "OP · Court 2 · 7:45 PM–8:05 PM", qty: 1, amountCents: 3500 },
        { id: "li-3", type: "PRODUCT", description: "Water", qty: 2, amountCents: 2000 },
      ],
    },
  ];

  it("lists every game with its court and time, each add-on, and the total", async () => {
    render(<TabsPanel tabs={itemised} paymentMethods={[]} products={[]} />);
    expect(screen.queryByText("OP · Court 1 · 7:20 PM–7:40 PM")).not.toBeInTheDocument();

    await clickAsync(screen.getByRole("button", { name: /^settle$/i }));

    const list = screen.getByRole("list", { name: "Typo Namez's charges" });
    expect(list).toHaveTextContent("OP · Court 1 · 7:20 PM–7:40 PM");
    expect(list).toHaveTextContent("OP · Court 2 · 7:45 PM–8:05 PM");
    expect(list).toHaveTextContent("Water ×2");
    expect(list).toHaveTextContent("Total");
    // The add-on button and the settle confirmation are still there.
    expect(screen.getByRole("button", { name: /add-on/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /settled$/i })).toBeInTheDocument();
  });
});
