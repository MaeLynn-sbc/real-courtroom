import { buildLine, forecastCourts, packUnits } from "./line-sets";

describe("packUnits", () => {
  it("fills sets of four in order", () => {
    expect(packUnits([["A"], ["B"], ["C"], ["D"], ["E"]])).toEqual([["A", "B", "C", "D"], ["E"]]);
  });

  it("never splits a pair across two sets, closing the set short instead", () => {
    // A, B, C are singles; D+E came together. D+E cannot fit beside A,B,C
    // so set 1 closes at three and D+E open set 2 — in the order they
    // registered, nobody jumps ahead.
    expect(packUnits([["A"], ["B"], ["C"], ["D", "E"], ["F"]])).toEqual([["A", "B", "C"], ["D", "E", "F"]]);
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
    expect(line.map((s) => [s.number, s.kind, s.label, s.names])).toEqual([
      [1, "staged", "Next up", ["W", "X", "Y", "Z"]],
      [2, "staged", "After that", ["P", "Q", "R", "S"]],
      [3, "preview", "Set 3", ["Ana", "Ben", "Cai", "Dee"]],
      [4, "preview", "Set 4", ["Eli"]],
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
        { slot: "NEXT_UP", names: ["A"] },
        { slot: "AFTER_THAT", names: ["B"] },
        { slot: "THEN", names: ["C"] },
      ],
    });
    expect(line[0].court?.courtName).toBe("Court 1");
    expect(line[1].court?.courtName).toBe("Court 2");
    expect(line[2].court).toBeUndefined();
    expect(line[3].court).toBeUndefined();
  });
});
