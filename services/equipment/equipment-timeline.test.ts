import { mergeTimelineEvents, type EquipmentTimelineEvent } from "@/services/equipment/equipment-timeline";

describe("mergeTimelineEvents", () => {
  it("sorts events from different sources into one most-recent-first feed", () => {
    const events: EquipmentTimelineEvent[] = [
      { type: "RENTAL_ISSUED", occurredAt: new Date(2026, 0, 1), title: "Oldest" },
      { type: "MAINTENANCE_LOGGED", occurredAt: new Date(2026, 6, 20), title: "Newest" },
      { type: "RENTAL_RETURNED", occurredAt: new Date(2026, 3, 15), title: "Middle" },
    ];

    const merged = mergeTimelineEvents(events);

    expect(merged.map((event) => event.title)).toEqual(["Newest", "Middle", "Oldest"]);
  });

  it("does not mutate the input array", () => {
    const events: EquipmentTimelineEvent[] = [
      { type: "RENTAL_ISSUED", occurredAt: new Date(2026, 0, 1), title: "A" },
      { type: "RENTAL_ISSUED", occurredAt: new Date(2026, 6, 20), title: "B" },
    ];
    const original = [...events];

    mergeTimelineEvents(events);

    expect(events).toEqual(original);
  });

  it("returns an empty array for no events", () => {
    expect(mergeTimelineEvents([])).toEqual([]);
  });
});
