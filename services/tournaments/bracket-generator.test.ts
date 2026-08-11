import {
  dividePoolsEvenly,
  generateRoundRobinPairings,
  generateSingleEliminationRound1,
  pairNextRound,
} from "@/services/tournaments/bracket-generator";

describe("generateRoundRobinPairings", () => {
  it("pairs every team with every other team exactly once for an even count", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C", "D"]);
    expect(pairings).toHaveLength(6);

    const played = new Map<string, Set<string>>();
    for (const team of ["A", "B", "C", "D"]) played.set(team, new Set());
    for (const { team1Id, team2Id } of pairings) {
      played.get(team1Id)!.add(team2Id);
      played.get(team2Id)!.add(team1Id);
    }
    for (const team of ["A", "B", "C", "D"]) {
      expect(played.get(team)!.size).toBe(3);
    }
  });

  it("gives every team exactly one bye round for an odd count, with no duplicate pairings", () => {
    const pairings = generateRoundRobinPairings(["A", "B", "C"]);
    expect(pairings).toHaveLength(3);

    const seen = new Set<string>();
    for (const { team1Id, team2Id } of pairings) {
      const key = [team1Id, team2Id].sort().join("-");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }

    const roundsPlayedIn = new Map<string, Set<number>>();
    for (const team of ["A", "B", "C"]) roundsPlayedIn.set(team, new Set());
    for (const { round, team1Id, team2Id } of pairings) {
      roundsPlayedIn.get(team1Id)!.add(round);
      roundsPlayedIn.get(team2Id)!.add(round);
    }
    // 3 rounds total, each team plays in 2 of them (byes 1 round).
    for (const team of ["A", "B", "C"]) {
      expect(roundsPlayedIn.get(team)!.size).toBe(2);
    }
  });

  it("returns no pairings for fewer than 2 teams", () => {
    expect(generateRoundRobinPairings([])).toEqual([]);
    expect(generateRoundRobinPairings(["A"])).toEqual([]);
  });
});

describe("generateSingleEliminationRound1", () => {
  it("pairs everyone with no byes when the count is already a power of 2", () => {
    const pairings = generateSingleEliminationRound1(["A", "B", "C", "D"]);
    expect(pairings).toHaveLength(2);
    expect(pairings.every((p) => p.team2Id !== null)).toBe(true);
  });

  it("pads an odd count up to the next power of 2 with byes", () => {
    const pairings = generateSingleEliminationRound1(["A", "B", "C"]);
    // Padded to 4: one bye slot, one real match.
    expect(pairings).toHaveLength(2);
    const byes = pairings.filter((p) => p.team2Id === null);
    const realMatches = pairings.filter((p) => p.team2Id !== null);
    expect(byes).toHaveLength(1);
    expect(realMatches).toHaveLength(1);
  });

  it("pads 5 teams up to 8 slots with 3 byes", () => {
    const pairings = generateSingleEliminationRound1(["A", "B", "C", "D", "E"]);
    const byes = pairings.filter((p) => p.team2Id === null);
    const realMatches = pairings.filter((p) => p.team2Id !== null);
    expect(byes).toHaveLength(3);
    expect(realMatches).toHaveLength(1);
  });

  it("returns no pairings for fewer than 2 teams", () => {
    expect(generateSingleEliminationRound1([])).toEqual([]);
    expect(generateSingleEliminationRound1(["A"])).toEqual([]);
  });
});

describe("dividePoolsEvenly", () => {
  it("splits an exactly-divisible field into equal pools", () => {
    const pools = dividePoolsEvenly(["A", "B", "C", "D", "E", "F"], 2);
    expect(pools).toHaveLength(2);
    expect(pools[0].poolLabel).toBe("A");
    expect(pools[1].poolLabel).toBe("B");
    expect(pools[0].teamIds).toHaveLength(3);
    expect(pools[1].teamIds).toHaveLength(3);
  });

  it("spreads a remainder evenly across pools instead of dumping it in the last one", () => {
    const teamIds = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const pools = dividePoolsEvenly(teamIds, 3);
    const sizes = pools.map((pool) => pool.teamIds.length).sort((a, b) => b - a);
    expect(sizes).toEqual([4, 3, 3]);
  });

  it("every team appears in exactly one pool, none dropped or duplicated", () => {
    const teamIds = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const pools = dividePoolsEvenly(teamIds, 3);
    const allAssigned = pools.flatMap((pool) => pool.teamIds).sort();
    expect(allAssigned).toEqual([...teamIds].sort());
  });

  it("refuses more pools than teams", () => {
    expect(() => dividePoolsEvenly(["A", "B"], 3)).toThrow("Cannot create more pools");
  });

  it("refuses fewer than 1 pool", () => {
    expect(() => dividePoolsEvenly(["A", "B"], 0)).toThrow("at least 1 pool");
  });
});

describe("pairNextRound", () => {
  it("pairs adjacent winners in order", () => {
    expect(pairNextRound(["A", "B", "C", "D"])).toEqual([
      { team1Id: "A", team2Id: "B" },
      { team1Id: "C", team2Id: "D" },
    ]);
  });

  it("returns an empty array when only one winner remains (the final is over)", () => {
    expect(pairNextRound(["A"])).toEqual([]);
    expect(pairNextRound([])).toEqual([]);
  });
});
