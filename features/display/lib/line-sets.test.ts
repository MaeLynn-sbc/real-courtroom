import { buildLine, forecastCourts, packUnits } from "./line-sets";

describe("packUnits", () => {
  it("fills sets of four in order", () => {
    expect(packUnits([["A"], ["B"], ["C"], ["D"], ["E"]])).toEqual([["A", "B", "C", "D"], ["E"]]);
  });

  it("never splits a pair, and fills the set with the next single that fits instead", () => {
    // A, B, C are singles; D+E came together and cannot fit beside them,
    // so F (the next single) takes the fourth seat and D+E open set 2.
    // Same as a paddle box: a set of three never goes up as a game.
    expect(packUnits([["A"], ["B"], ["C"], ["D", "E"], ["F"]])).toEqual([["A", "B", "C", "F"], ["D", "E"]]);
    // With nothing later that fits, the last set is simply short.
    expect(packUnits([["A"], ["B"], ["C"], ["D", "E"]])).toEqual([["A", "B", "C"], ["D", "E"]]);
  });

  it("keeps two pairs together as one set", () => {
    expect(packUnits([["A", "B"], ["C", "D"], ["E"]])).toEqual([["A", "B", "C", "D"], ["E"]]);
  });
});

describe("buildLine", () => {
  it("numbers staged groups first, then preview sets, continuously", () => {
    const line = buildLine({
      queue: ["Ana", "Ben", "Cai", "Dee", "Eli"],
      queueUnits: [
        [{ name: "Ana", skill: "BEGINNER" }],
        [{ name: "Ben", skill: "NOVICE" }, { name: "Cai", skill: "NOVICE" }],
        [{ name: "Dee", skill: "ADVANCED" }],
        [{ name: "Eli", skill: "INTERMEDIATE" }],
      ],
      stagedGroups: [
        { slot: "AFTER_THAT", names: ["P", "Q", "R", "S"] },
        { slot: "NEXT_UP", names: ["W", "X", "Y", "Z"] },
      ],
    });
    expect(line.map((s) => [s.number, s.kind, s.label, s.names, s.missing])).toEqual([
      [1, "staged", "Next up", ["W", "X", "Y", "Z"], 0],
      [2, "staged", "After that", ["P", "Q", "R", "S"], 0],
      [3, "preview", "Set 3", ["Ana", "Ben", "Cai", "Dee"], 0],
      [4, "preview", "Set 4", ["Eli"], 3],
    ]);
  });

  it("falls back to the flat queue when units are absent", () => {
    const line = buildLine({ queue: ["A", "B", "C", "D", "E"], stagedGroups: [] });
    expect(line.map((s) => s.names)).toEqual([["A", "B", "C", "D"], ["E"]]);
    expect(line[0].players[0]).toEqual({ name: "A", skill: null });
  });

  it("carries each player's skill so the screen can colour the name", () => {
    const line = buildLine({
      queue: ["Ana"],
      queueUnits: [[{ name: "Ana", skill: "ADVANCED" }]],
      stagedGroups: [{ slot: "NEXT_UP", names: ["W"], members: [{ name: "W", skill: "BEGINNER" }] }],
    });
    expect(line[0].players).toEqual([{ name: "W", skill: "BEGINNER" }]);
    expect(line[1].players).toEqual([{ name: "Ana", skill: "ADVANCED" }]);
  });
});

describe("forecastCourts", () => {
  const free = { id: "c1", name: "Court 1", state: "free" as const, players: [] as [], startAt: null, endAt: null, next: null };
  const playing = (name: string, endAt: string) =>
    ({ id: name, name, state: "op" as const, players: [], startAt: "2031-04-07T10:00:00.000Z", endAt, announcementRequestedAt: null, timesUpRequestedAt: null, next: null }) as never;
  const pending = { id: "c3", name: "Court 3", state: "op-pending" as const, players: [], proposedAt: "2031-04-07T10:50:00.000Z", nudgeAt: "", announcementRequestedAt: null, startAt: null, endAt: null, next: null };

  it("offers free courts first, then busy courts in the order their games end", () => {
    const forecast = forecastCourts({
      courts: [playing("Court 2", "2031-04-07T11:00:00.000Z"), free, playing("Court 4", "2031-04-07T10:40:00.000Z")],
      targetGameMinutes: 20,
    });
    expect(forecast.map((f) => [f.courtName, f.readyAt])).toEqual([
      ["Court 1", null],
      ["Court 4", "2031-04-07T10:40:00.000Z"],
      ["Court 2", "2031-04-07T11:00:00.000Z"],
    ]);
  });

  it("treats a group about to start as busy for one full game", () => {
    const forecast = forecastCourts({ courts: [pending], targetGameMinutes: 20 });
    expect(forecast[0].readyAt).toBe("2031-04-07T11:10:00.000Z");
  });

  it("attaches the forecast to staged sets in pipeline order, never to preview sets", () => {
    const line = buildLine({
      courts: [free, playing("Court 2", "2031-04-07T11:00:00.000Z")],
      targetGameMinutes: 20,
      queue: ["Z"],
      stagedGroups: [
        { slot: "NEXT_UP", names: ["A", "B", "C", "D"] },
        { slot: "AFTER_THAT", names: ["E", "F", "G", "H"] },
        { slot: "THEN", names: ["I", "J", "K", "L"] },
      ],
    });
    expect(line[0].court?.courtName).toBe("Court 1");
    expect(line[1].court?.courtName).toBe("Court 2");
    // More full racks than courts: the line wraps back to the first court.
    expect(line[2].court?.courtName).toBe("Court 1");
    expect(line[2].court?.readyAt).not.toBeNull();
    expect(line[3].court).toBeUndefined(); // a waiting preview set never gets a court
  });

  it("a staged set of three is not next on any court; the next full set takes it", () => {
    const line = buildLine({
      courts: [free, playing("Court 2", "2031-04-07T11:00:00.000Z")],
      targetGameMinutes: 20,
      queue: [],
      stagedGroups: [
        { slot: "NEXT_UP", names: ["A", "B", "C"] },
        { slot: "AFTER_THAT", names: ["E", "F", "G", "H"] },
      ],
    });
    expect(line[0].missing).toBe(1);
    expect(line[0].court).toBeUndefined();
    expect(line[1].court?.courtName).toBe("Court 1");
  });
});

describe("buildLine — the nine-position line", () => {
  const busy = (name: string, endAt: string) =>
    ({ id: name, name, state: "op" as const, players: [], startAt: "2031-04-07T10:00:00.000Z", endAt, announcementRequestedAt: null, timesUpRequestedAt: null, next: null }) as never;
  const four = (p: string) => [`${p}1`, `${p}2`, `${p}3`, `${p}4`];

  it("labels Next up / After that / Then / Rack 1-3 and wraps the court forecast one game later per lap", () => {
    const line = buildLine({
      courts: [busy("Court 1", "2031-04-07T10:20:00.000Z"), busy("Court 2", "2031-04-07T10:30:00.000Z")],
      targetGameMinutes: 20,
      queue: [],
      stagedGroups: [
        { slot: "NEXT_UP", names: four("a") },
        { slot: "AFTER_THAT", names: four("b") },
        { slot: "THEN", names: four("c") },
        { slot: "RACK_4", names: four("d") },
        { slot: "RACK_5", names: ["e1"] },
        { slot: "RACK_6", names: four("f") },
      ],
    });
    expect(line.map((s) => s.label)).toEqual(["Next up", "After that", "Then", "Rack 1", "Rack 2", "Rack 3"]);
    expect(line.map((s) => [s.court?.courtName, s.court?.readyAt])).toEqual([
      ["Court 1", "2031-04-07T10:20:00.000Z"],
      ["Court 2", "2031-04-07T10:30:00.000Z"],
      ["Court 1", "2031-04-07T10:40:00.000Z"],
      ["Court 2", "2031-04-07T10:50:00.000Z"],
      [undefined, undefined], // Rack 2 has one player: not a game yet
      ["Court 1", "2031-04-07T11:00:00.000Z"],
    ]);
  });
});

describe("buildLine — racks 4 to 6", () => {
  it("labels the last three positions Rack 4 to Rack 6", () => {
    const line = buildLine({
      queue: [],
      stagedGroups: [
        { slot: "RACK_7", names: ["a"] },
        { slot: "RACK_8", names: ["b"] },
        { slot: "RACK_9", names: ["c"] },
      ],
    });
    expect(line.map((s) => s.label)).toEqual(["Rack 4", "Rack 5", "Rack 6"]);
  });
});
