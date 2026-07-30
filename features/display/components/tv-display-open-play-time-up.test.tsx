import { render, screen } from "@testing-library/react";

import { TvDisplayClient } from "./tv-display-client";
import type { DisplayData } from "@/services/display/display.service";

// Reported live: the red "time's up" flash fired when an hourly booking's
// endAt passed, but never for an open-play game hitting its
// targetGameMinutes limit — isTimeUpFlashing was only ever wired into the
// booking ("res") branch of CourtCard, even though display.service.ts
// already computes court.endAt for "op" the same way (start +
// targetGameMinutes) and the function itself is generic. This renders the
// real TvDisplayClient (not just the pure isTimeUpFlashing function,
// already covered in tv-display-client.test.ts) to prove the CSS class
// actually lands on an "op" court card, not just that the underlying
// timing math is correct in isolation.
function displayData(courtState: "op" | "free", endAt: string): DisplayData {
  return {
    generatedAt: "2026-07-28T00:00:00.000Z",
    targetGameMinutes: 15,
    courts: [
      courtState === "op"
        ? {
            id: "court-2",
            name: "Court 2",
            state: "op",
            players: [{ name: "Ana" }],
            startAt: "2026-07-27T23:45:00.000Z",
            endAt,
            announcementRequestedAt: null,
            next: null,
          }
        : { id: "court-2", name: "Court 2", state: "free", players: [], startAt: null, endAt: null, next: null },
    ],
    queue: [],
  };
}

describe("TvDisplayClient — open-play courts flash when their time limit passes", () => {
  it("applies the time-up flash to an open-play court whose endAt passed a few seconds ago", () => {
    // isTimeUpFlashing only holds true while overtime is within the flash
    // duration window (0 <= overtimeMs <= flashDurationMs) — endAt must be
    // RECENTLY past, not arbitrarily long ago, or the flash window itself
    // would already have elapsed too.
    const recentlyEnded = new Date(Date.now() - 5_000).toISOString();
    const data = displayData("op", recentlyEnded);
    render(<TvDisplayClient initialData={data} announcementRepeatCount={1} timeUpFlashDurationSeconds={30} announcementVoice={null} refreshIntervalSeconds={10} />);

    const card = screen.getByText("Court 2").parentElement!.parentElement;
    expect(card).not.toBeNull();
    expect(card!.className).toMatch(/timeUp/);
  });

  it("does not flash an open-play court still well within its time limit", () => {
    const farFuture = new Date(Date.now() + 60 * 60_000).toISOString();
    const data = displayData("op", farFuture);
    render(<TvDisplayClient initialData={data} announcementRepeatCount={1} timeUpFlashDurationSeconds={30} announcementVoice={null} refreshIntervalSeconds={10} />);

    const card = screen.getByText("Court 2").parentElement!.parentElement;
    expect(card).not.toBeNull();
    expect(card!.className).not.toMatch(/timeUp/);
  });
});
