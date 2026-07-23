import { mergeTimelineEvents, type LockerTimelineEvent } from "@/services/lockers/locker-timeline";

describe("mergeTimelineEvents", () => {
  it("sorts events from different sources into one most-recent-first feed", () => {
    const events: LockerTimelineEvent[] = [
      { type: "RENTAL_ISSUED", occurredAt: new Date(2026, 0, 1), title: "Oldest" },
      { type: "MAINTENANCE_LOGGED", occurredAt: new Date(2026, 6, 20), title: "Newest" },
      { type: "RENTAL_ENDED", occurredAt: new Date(2026, 3, 15), title: "Middle" },
    ];

    const merged = mergeTimelineEvents(events);

    expect(merged.map((event) => event.title)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("returns an empty array for no events", () => {
    expect(mergeTimelineEvents([])).toEqual([]);
  });
});
