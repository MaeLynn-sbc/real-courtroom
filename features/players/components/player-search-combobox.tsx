"use client";

import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";

// Shared search-as-you-type player picker — first built for New
// Booking's "Player" field (replacing a scrollable "every player"
// dropdown), now reused here for open-play walk-in registration
// instead of a second, separately-built combobox. Generic over T so
// each caller can carry whatever extra fields it needs on a match
// (the booking form only needs an id/label; walk-in registration also
// needs phone + skill level to prefill) — onSelectPlayer always
// receives the full matched object, so that prefill logic lives in
// the caller, not here.
export interface PlayerSearchOption {
  id: string;
  label: string;
}

// First name of a "First Last" (or "First" / email-fallback) label —
// matching goes off this leading token only, e.g. "j" -> J names.
function firstToken(label: string): string {
  return label.trim().split(/\s+/)[0] ?? "";
}

interface PlayerSearchComboboxProps<T extends PlayerSearchOption> {
  id?: string;
  players: T[];
  selectedPlayerId: string | null;
  text: string;
  onSelectPlayer: (player: T) => void;
  onTextChange: (text: string) => void;
  placeholder?: string;
  // Shown under the field when typed text matches nobody — omit for a
  // caller that has nothing special to say about that case.
  noMatchHint?: (text: string) => string;
}

export function PlayerSearchCombobox<T extends PlayerSearchOption>({
  id,
  players,
  selectedPlayerId,
  text,
  onSelectPlayer,
  onTextChange,
  placeholder,
  noMatchHint,
}: PlayerSearchComboboxProps<T>) {
  const selectedPlayer = selectedPlayerId ? players.find((player) => player.id === selectedPlayerId) : null;
  const displayValue = selectedPlayer ? selectedPlayer.label : text;
  const [isOpen, setIsOpen] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const query = displayValue.trim();
  const matches = query
    ? players.filter((player) => firstToken(player.label).toLowerCase().startsWith(query.toLowerCase())).slice(0, 8)
    : [];

  function handleChange(value: string) {
    // Any edit invalidates a prior match — the text no longer
    // necessarily names that player, until (if ever) it matches and
    // gets picked again.
    onTextChange(value);
    setIsOpen(value.trim().length > 0);
  }

  function handlePick(player: T) {
    onSelectPlayer(player);
    setIsOpen(false);
  }

  return (
    <div className="relative">
      <Input
        id={id}
        value={displayValue}
        placeholder={placeholder}
        onChange={(event) => handleChange(event.target.value)}
        onFocus={() => setIsOpen(query.length > 0 && matches.length > 0)}
        onBlur={() => {
          // Let a click on an option register before the list closes.
          blurTimeout.current = setTimeout(() => setIsOpen(false), 150);
        }}
        autoComplete="off"
      />
      {isOpen && matches.length > 0 ? (
        <div
          className="bg-popover text-popover-foreground ring-foreground/10 absolute top-full z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg shadow-md ring-1"
          onMouseDown={(event) => {
            // Fires before the input's onBlur — cancel the pending close
            // so the click below actually lands on an option.
            event.preventDefault();
            if (blurTimeout.current) clearTimeout(blurTimeout.current);
          }}
        >
          {matches.map((player) => (
            <button
              key={player.id}
              type="button"
              onClick={() => handlePick(player)}
              className="hover:bg-accent block w-full px-3 py-2 text-left text-sm"
            >
              {player.label}
            </button>
          ))}
        </div>
      ) : null}
      {!selectedPlayer && noMatchHint && text.trim() ? (
        <p className="text-muted-foreground mt-1 text-xs">{noMatchHint(text.trim())}</p>
      ) : null}
    </div>
  );
}
