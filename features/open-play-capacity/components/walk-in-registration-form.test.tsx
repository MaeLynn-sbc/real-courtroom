import { act, fireEvent, render } from "@testing-library/react";

import { WalkInRegistrationForm, type RegistrablePlayer } from "./walk-in-registration-form";
import { registerAndCheckInAction } from "@/actions/open-play-checkin.actions";
import { registerWalkInAction } from "@/actions/open-play-registration.actions";

jest.mock("@/actions/open-play-checkin.actions", () => ({
  registerAndCheckInAction: jest.fn(),
}));
jest.mock("@/actions/open-play-registration.actions", () => ({
  registerWalkInAction: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

const mockedRegisterWalkIn = registerWalkInAction as jest.MockedFunction<
  typeof registerWalkInAction
>;
const mockedRegisterAndCheckIn = registerAndCheckInAction as jest.MockedFunction<
  typeof registerAndCheckInAction
>;

const players: RegistrablePlayer[] = [];
const paymentMethods = [{ id: "pm-cash", key: "CASH" as const, label: "Cash" }];

async function clickAsync(element: Element) {
  await act(async () => {
    fireEvent.click(element);
  });
}

// URGENT, money-critical (reported live): before the Fri/Sat cutoff, the
// page now renders TWO instances of this form side by side (regular +
// unlimited). Every field id used to be a hardcoded literal shared by
// both instances — invalid, duplicate DOM ids, and a customer's
// "unlimited session" submission vanished with no trace anywhere,
// because a mis-focused field left this form's own React state empty,
// which fails the client-side "enter a name and phone" check *before*
// any server action is ever called. formId makes every id unique per
// instance — these tests prove the two rendered forms don't collide,
// and that filling in the SECOND form submits the SECOND form's own
// data, not the first form's.
describe("WalkInRegistrationForm — two instances rendered together (pre-cutoff dual form)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  function renderBothForms() {
    return render(
      <>
        <WalkInRegistrationForm
          formId="regularWalkIn"
          title="Register a walk-in (playing now)"
          target={{ date: "2026-08-01" }}
          players={players}
        />
        <WalkInRegistrationForm
          formId="unlimitedWalkIn"
          title="Register for tonight's unlimited session"
          target={{ sessionId: "session-1" }}
          players={players}
          paymentMethods={paymentMethods}
        />
      </>,
    );
  }

  it("never renders two elements with the same id across both instances", () => {
    const { container } = renderBothForms();
    const ids = Array.from(container.querySelectorAll("[id]")).map((el) => el.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it("submits the SECOND (unlimited) form's own typed data via Register only, not the first form's", async () => {
    mockedRegisterWalkIn.mockResolvedValue({ error: null });
    const { container } = renderBothForms();

    // Deliberately leave the FIRST form untouched (empty) — exactly the
    // scenario that used to matter: if focus/typing had crossed over to
    // the wrong instance, the SECOND form's own state would still be
    // empty here and this submission would never reach the server at all.
    const unlimitedName = container.querySelector<HTMLInputElement>("#unlimitedWalkInName")!;
    const unlimitedPhone = container.querySelector<HTMLInputElement>("#unlimitedWalkInPhone")!;
    expect(unlimitedName).toBeTruthy();
    expect(unlimitedPhone).toBeTruthy();

    await act(async () => {
      fireEvent.change(unlimitedName, { target: { value: "Unlimited Guest" } });
      fireEvent.change(unlimitedPhone, { target: { value: "09171234567" } });
    });

    // Owner request (2026-08-08), root-cause fix: no default payment
    // method anymore — the attendant must actively pick one before
    // Register only/Walk-in even become clickable.
    const unlimitedCashButton = container.querySelector<HTMLButtonElement>(
      "#unlimitedWalkInPaymentMethod-CASH",
    )!;
    expect(unlimitedCashButton).toBeTruthy();
    await clickAsync(unlimitedCashButton);

    const registerOnlyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Register only (arriving later)",
    )!;
    expect(registerOnlyButton).toBeTruthy();
    await clickAsync(registerOnlyButton);

    expect(mockedRegisterWalkIn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        playerName: "Unlimited Guest",
        phone: "09171234567",
        method: "CASH",
        paymentMethodId: "pm-cash",
      }),
    );
    expect(mockedRegisterAndCheckIn).not.toHaveBeenCalled();
  });

  it("filling the first (regular) form does not leak into the second form's fields", async () => {
    const { container } = renderBothForms();

    const regularName = container.querySelector<HTMLInputElement>("#regularWalkInName")!;
    await act(async () => {
      fireEvent.change(regularName, { target: { value: "Regular Guest" } });
    });

    const unlimitedName = container.querySelector<HTMLInputElement>("#unlimitedWalkInName")!;
    expect(unlimitedName.value).toBe("");
    expect(regularName.value).toBe("Regular Guest");
  });

  it("only the unlimited-session form offers Register only — the regular form has no session to register-only into", () => {
    const { container } = renderBothForms();
    const registerOnlyButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Register only (arriving later)",
    );
    expect(registerOnlyButtons).toHaveLength(1);
  });
});

// Owner request (2026-08-08), root-cause fix for attendants recording a
// Cash payment as GCash (or the reverse): a capacity-night walk-in can no
// longer be submitted with a silently-defaulted payment method — neither
// button starts selected, and both submit buttons stay disabled until one
// is actively chosen.
describe("WalkInRegistrationForm — capacity night requires an explicit payment choice", () => {
  const twoMethods = [
    { id: "pm-cash", key: "CASH" as const, label: "Cash" },
    { id: "pm-gcash", key: "GCASH" as const, label: "GCash" },
  ];

  it("neither payment button starts selected, and Walk-in/Register only start disabled", () => {
    const { getByRole } = render(
      <WalkInRegistrationForm
        target={{ sessionId: "session-1" }}
        players={players}
        paymentMethods={twoMethods}
      />,
    );
    expect(getByRole("button", { name: "Cash" })).toHaveAttribute("aria-pressed", "false");
    expect(getByRole("button", { name: "GCash" })).toHaveAttribute("aria-pressed", "false");
    expect(getByRole("button", { name: /walk-in/i })).toBeDisabled();
    expect(getByRole("button", { name: /register only/i })).toBeDisabled();
  });

  it("choosing Cash enables both submit buttons", async () => {
    const { getByRole } = render(
      <WalkInRegistrationForm
        target={{ sessionId: "session-1" }}
        players={players}
        paymentMethods={twoMethods}
      />,
    );
    await clickAsync(getByRole("button", { name: "Cash" }));
    expect(getByRole("button", { name: /walk-in/i })).toBeEnabled();
    expect(getByRole("button", { name: /register only/i })).toBeEnabled();
  });

  it("a weeknight (non-capacity) form is never gated on a payment choice — it has no payment picker at all", () => {
    const { getByRole, queryByRole } = render(
      <WalkInRegistrationForm target={{ date: "2026-08-01" }} players={players} />,
    );
    expect(queryByRole("button", { name: "Cash" })).not.toBeInTheDocument();
    expect(getByRole("button", { name: /walk-in/i })).toBeEnabled();
  });
});
