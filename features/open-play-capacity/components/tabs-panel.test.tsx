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
