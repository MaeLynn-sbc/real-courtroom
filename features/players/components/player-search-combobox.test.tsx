import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { PlayerSearchCombobox } from "./player-search-combobox";

const players = [
  { id: "p1", label: "Coach Dhudz Quinto" },
  { id: "p2", label: "Ana Reyes" },
  { id: "p3", label: "Domingo Santos" },
];

function Harness({ initialText = "" }: { initialText?: string }) {
  const [text, setText] = useState(initialText);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <PlayerSearchCombobox
      players={players}
      selectedPlayerId={selectedId}
      text={text}
      onTextChange={(value: string) => {
        setSelectedId(null);
        setText(value);
      }}
      onSelectPlayer={(player: { id: string }) => setSelectedId(player.id)}
    />
  );
}

async function type(input: HTMLElement, value: string) {
  await act(async () => {
    fireEvent.change(input, { target: { value } });
  });
}

describe("PlayerSearchCombobox", () => {
  it("matches a word other than the first — the reported 'Dhudz' bug", async () => {
    render(<Harness />);
    await type(screen.getByRole("textbox"), "Dhudz");
    expect(screen.getByRole("button", { name: "Coach Dhudz Quinto" })).toBeInTheDocument();
  });

  it("matches mid-word, not just a word's start (contains, not prefix-only)", async () => {
    render(<Harness />);
    await type(screen.getByRole("textbox"), "hudz");
    expect(screen.getByRole("button", { name: "Coach Dhudz Quinto" })).toBeInTheDocument();
  });

  it("is case-insensitive", async () => {
    render(<Harness />);
    await type(screen.getByRole("textbox"), "dhudz");
    expect(screen.getByRole("button", { name: "Coach Dhudz Quinto" })).toBeInTheDocument();
  });

  it("still matches on the first word, unaffected", async () => {
    render(<Harness />);
    await type(screen.getByRole("textbox"), "Ana");
    expect(screen.getByRole("button", { name: "Ana Reyes" })).toBeInTheDocument();
  });

  it("does not show unrelated players", async () => {
    render(<Harness />);
    await type(screen.getByRole("textbox"), "Dhudz");
    expect(screen.queryByRole("button", { name: "Ana Reyes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Domingo Santos" })).not.toBeInTheDocument();
  });
});
