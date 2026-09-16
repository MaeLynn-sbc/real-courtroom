import { buildLine, packUnits } from "./line-sets";

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
