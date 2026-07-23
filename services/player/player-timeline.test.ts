import { mergeTimelineEvents, type PlayerTimelineEvent } from "@/services/player/player-timeline";

describe("mergeTimelineEvents", () => {
  it("sorts events from different sources into one most-recent-first feed", () => {
    const events: PlayerTimelineEvent[] = [
      { type: "BOOKING", occurredAt: new Date(2026, 0, 1), title: "Oldest" },
      { type: "MEMBERSHIP_EVENT", occurredAt: new Date(2026, 6, 20), title: "Newest" },
      { type: "TOURNAMENT_REGISTRATION", occurredAt: new Date(2026, 3, 15), title: "Middle" },
    ];

    const merged = mergeTimelineEvents(events);

    expect(merged.map((event) => event.title)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("does not mutate the input array", () => {
    const events: PlayerTimelineEvent[] = [
      { type: "BOOKING", occurredAt: new Date(2026, 0, 1), title: "A" },
      { type: "BOOKING", occurredAt: new Date(2026, 6, 20), title: "B" },
    ];
    const original = [...events];

    mergeTimelineEvents(events);

    expect(events).toEqual(original);
  });

  it("returns an empty array for no events", () => {
    expect(mergeTimelineEvents([])).toEqual([]);
  });
});
