import { render, screen } from "@testing-library/react";

import { TvDisplayClient } from "./tv-display-client";
import type { DisplayData } from "@/services/display/display.service";

// Reported live: the assignment announcement is deliberately manual
// (players take time to walk over), but a one-minute warning for a
// RUNNING open-play game is purely clock-driven, relative to a timer
// staff already started — no human judgment involved, so this one is
// automatic. Requirement 5 asked for a visual cue distinct from the
// existing time's-up flash, so a court in its final minute looks
// different even with the sound off. Renders the real TvDisplayClient
// (not just isGameWarningActive in isolation, already covered in
// tv-display-client.test.ts) to prove the CSS class actually lands on
// the card.
function displayData(endAt: string): DisplayData {
  return {
    generatedAt: "2026-07-28T00:00:00.000Z",
    targetGameMinutes: 15,
    courts: [
      {
        id: "court-2",
        name: "Court 2",
        state: "op",
        players: [{ name: "Ana" }],
        startAt: "2026-07-27T23:45:00.000Z",
        endAt,
        announcementRequestedAt: null,
        timesUpRequestedAt: null,
        next: null,
      },
    ],
    queue: [],
    stagedGroups: [],
  };
}

describe("TvDisplayClient — open-play game warning visual cue", () => {
  it("applies the warning class to an open-play court within the configured warning window", () => {
    const almostOver = new Date(Date.now() + 30_000).toISOString(); // 30s left, inside a 1-minute warning
    const data = displayData(almostOver);
    render(
      <TvDisplayClient
        initialData={data}
        announcementRepeatCount={1}
        timeUpFlashDurationSeconds={30}
        announcementVoice={null}
        refreshIntervalSeconds={10}
        gameWarningEnabled
        gameWarningMinutes={1}
        timesUpTemplate="Reminder, {court}, your time is up!"
      />,
    );

    const card = screen.getByText("Court 2").parentElement!.parentElement;
    expect(card).not.toBeNull();
    expect(card!.className).toMatch(/warningSoon/);
    expect(card!.className).not.toMatch(/timeUp/);
  });

  it("does not apply the warning class to a court still well outside the warning window", () => {
    const farFuture = new Date(Date.now() + 60 * 60_000).toISOString();
    const data = displayData(farFuture);
    render(
      <TvDisplayClient
        initialData={data}
        announcementRepeatCount={1}
        timeUpFlashDurationSeconds={30}
        announcementVoice={null}
        refreshIntervalSeconds={10}
        gameWarningEnabled
        gameWarningMinutes={1}
        timesUpTemplate="Reminder, {court}, your time is up!"
      />,
    );

    const card = screen.getByText("Court 2").parentElement!.parentElement;
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/warningSoon/);
  });

  it("does not apply the warning class when the owner has turned the warning off, even within the window", () => {
    const almostOver = new Date(Date.now() + 30_000).toISOString();
    const data = displayData(almostOver);
    render(
      <TvDisplayClient
        initialData={data}
        announcementRepeatCount={1}
        timeUpFlashDurationSeconds={30}
        announcementVoice={null}
        refreshIntervalSeconds={10}
        gameWarningEnabled={false}
        gameWarningMinutes={1}
        timesUpTemplate="Reminder, {court}, your time is up!"
      />,
    );

    const card = screen.getByText("Court 2").parentElement!.parentElement;
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/warningSoon/);
  });
});
