import {
  calculateEliminationStandings,
  calculateRoundRobinStandings,
  type StandingsMatchInput,
} from "@/services/tournaments/standings-calculator";

describe("calculateRoundRobinStandings", () => {
  it("ranks teams by wins", () => {
    const matches: StandingsMatchInput[] = [
      {
        round: 1,
        team1Id: "A",
        team2Id: "B",
        winnerTeamId: "A",
        status: "COMPLETED",
        scores: [
          { team1Score: 11, team2Score: 5 },
          { team1Score: 11, team2Score: 7 },
        ],
      },
      {
        round: 2,
        team1Id: "A",
        team2Id: "C",
        winnerTeamId: "C",
        status: "COMPLETED",
        scores: [
          { team1Score: 9, team2Score: 11 },
          { team1Score: 11, team2Score: 13 },
        ],
      },
      {
        round: 3,
        team1Id: "B",
        team2Id: "C",
        winnerTeamId: "C",
        status: "COMPLETED",
        scores: [
          { team1Score: 4, team2Score: 11 },
          { team1Score: 6, team2Score: 11 },
        ],
      },
    ];

    const standings = calculateRoundRobinStandings(["A", "B", "C"], matches);

    expect(standings[0].teamId).toBe("C");
    expect(standings[0].wins).toBe(2);
    expect(standings.find((s) => s.teamId === "A")!.wins).toBe(1);
    expect(standings.find((s) => s.teamId === "B")!.wins).toBe(0);
  });

  it("ignores matches that haven't been completed and byes", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: "B", winnerTeamId: null, status: "SCHEDULED", scores: [] },
      { round: 1, team1Id: "C", team2Id: null, winnerTeamId: "C", status: "COMPLETED", scores: [] },
    ];

    const standings = calculateRoundRobinStandings(["A", "B", "C"], matches);
    for (const row of standings) {
      expect(row.played).toBe(0);
    }
  });

  // Owner report (2026-08-11): "team A beats team B, B withdraws, A must
  // still show that win." teamIds omits B entirely — same as
  // standings.service.ts only seeding rows from CONFIRMED registrations,
  // so a withdrawn team never gets a row.
  it("still credits a win to a team whose opponent has since withdrawn (no row for the opponent)", () => {
    const matches: StandingsMatchInput[] = [
      {
        round: 1,
        team1Id: "A",
        team2Id: "B",
        winnerTeamId: "A",
        status: "COMPLETED",
        scores: [
          { team1Score: 11, team2Score: 5 },
          { team1Score: 11, team2Score: 7 },
        ],
      },
    ];

    // Only "A" is passed — "B" withdrew and no longer has a standings row.
    const standings = calculateRoundRobinStandings(["A"], matches);
    const teamA = standings.find((row) => row.teamId === "A");
    expect(teamA?.played).toBe(1);
    expect(teamA?.wins).toBe(1);
    expect(teamA?.losses).toBe(0);
  });

  // Owner request (2026-08-11): "the tiebreaker must use points" — two
  // teams with identical wins AND identical set differential, but
  // different point differential, must not tie.
  it("ranks by point differential, not set differential, when both teams have the same wins and set diff", () => {
    const matches: StandingsMatchInput[] = [
      // "X" wins 2-0 by a huge margin (+22 points), loses 0-2 by a small
      // margin (-4 points) — net 2 sets won, 2 lost (diff 0), but +18 points.
      {
        round: 1,
        team1Id: "X",
        team2Id: "OpponentOfX1",
        winnerTeamId: "X",
        status: "COMPLETED",
        scores: [
          { team1Score: 11, team2Score: 0 },
          { team1Score: 11, team2Score: 0 },
        ],
      },
      {
        round: 2,
        team1Id: "X",
        team2Id: "OpponentOfX2",
        winnerTeamId: "OpponentOfX2",
        status: "COMPLETED",
        scores: [
          { team1Score: 9, team2Score: 11 },
          { team1Score: 9, team2Score: 11 },
        ],
      },
      // "W" wins and loses by the same narrow margin both times — net 2
      // sets won, 2 lost (diff 0, same as X), but 0 net points.
      {
        round: 1,
        team1Id: "W",
        team2Id: "OpponentOfW1",
        winnerTeamId: "W",
        status: "COMPLETED",
        scores: [
          { team1Score: 11, team2Score: 9 },
          { team1Score: 11, team2Score: 9 },
        ],
      },
      {
        round: 2,
        team1Id: "W",
        team2Id: "OpponentOfW2",
        winnerTeamId: "OpponentOfW2",
        status: "COMPLETED",
        scores: [
          { team1Score: 9, team2Score: 11 },
          { team1Score: 9, team2Score: 11 },
        ],
      },
    ];

    const standings = calculateRoundRobinStandings(
      ["X", "W", "OpponentOfX1", "OpponentOfX2", "OpponentOfW1", "OpponentOfW2"],
      matches,
    );
    const teamX = standings.find((row) => row.teamId === "X")!;
    const teamW = standings.find((row) => row.teamId === "W")!;

    expect(teamX.wins).toBe(1);
    expect(teamW.wins).toBe(1);
    expect(teamX.setDifferential).toBe(0);
    expect(teamW.setDifferential).toBe(0);
    expect(teamX.pointDifferential).toBe(18);
    expect(teamW.pointDifferential).toBe(0);

    // Same wins, same set differential — must be ranked by point
    // differential, so X (the real tiebreak winner) sorts above W.
    expect(standings.indexOf(teamX)).toBeLessThan(standings.indexOf(teamW));
  });
});

function decisiveMatch(
  round: number,
  team1Id: string,
  team2Id: string,
  winnerTeamId: string,
  scores: { team1Score: number; team2Score: number }[],
): StandingsMatchInput {
  return { round, team1Id, team2Id, winnerTeamId, status: "COMPLETED", scores };
}

// Owner request (2026-08-11): the full 5-level USAP cascade. A single
// sort key can't express "fall through to the next tiebreaker only for
// the teams still tied" — these prove the recursive group-and-narrow
// behavior level by level, including the two places the doc calls out
// as genuinely tricky (a 3-way cycle head-to-head can't resolve, and
// tiebreaker 4's two skip conditions).
describe("calculateRoundRobinStandings — tiebreaker cascade", () => {
  it("resolves a clean 2-way tie at level 1 (direct head-to-head)", () => {
    const matches: StandingsMatchInput[] = [
      // A's only win IS the head-to-head game against B.
      decisiveMatch(1, "A2", "B2", "A2", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
      // B's only win is against a filler, equalizing wins at 1 each.
      decisiveMatch(2, "B2", "Y2", "B2", [
        { team1Score: 11, team2Score: 3 },
        { team1Score: 11, team2Score: 3 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["A2", "B2"], matches);
    expect(standings[0]!.teamId).toBe("A2");
    expect(standings[1]!.teamId).toBe("B2");
    expect(standings.every((row) => !row.tiedAfterAllTiebreakers)).toBe(true);
  });

  it("falls through a 3-way head-to-head cycle to point differential (level 2)", () => {
    // A beats B, B beats C, C beats A — every team has exactly 1
    // head-to-head win among the trio, so level 1 can't separate them.
    const matches: StandingsMatchInput[] = [
      decisiveMatch(1, "A3", "B3", "A3", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
      decisiveMatch(2, "B3", "C3", "B3", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
      decisiveMatch(3, "C3", "A3", "C3", [
        { team1Score: 11, team2Score: 2 },
        { team1Score: 11, team2Score: 2 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["A3", "B3", "C3"], matches);
    expect(standings.every((row) => row.wins === 1)).toBe(true);
    // Point differential: A3 = 12 - 18 = -6, B3 = -12 + 12 = 0, C3 = -12 + 18 = +6.
    expect(standings.map((row) => row.teamId)).toEqual(["C3", "B3", "A3"]);
    expect(standings.every((row) => !row.tiedAfterAllTiebreakers)).toBe(true);
  });

  it("partially resolves at level 1, recursing only the still-tied remainder into level 2", () => {
    // P beats Q head-to-head (1 h2h win) — resolved alone, ranks first.
    // Q and R never play each other within the trio (R joined without a
    // game against either), so both sit at 0 head-to-head wins — still
    // tied, must recurse to level 2 on their own, without re-involving P.
    const matches: StandingsMatchInput[] = [
      decisiveMatch(1, "P", "X4", "P", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(2, "P", "Q4", "P", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(3, "P", "Y4", "Y4", [
        { team1Score: 0, team2Score: 11 },
        { team1Score: 0, team2Score: 11 },
      ]),
      decisiveMatch(4, "Q4", "Y4", "Q4", [
        { team1Score: 11, team2Score: 2 },
        { team1Score: 11, team2Score: 2 },
      ]),
      decisiveMatch(5, "Q4", "X4", "Q4", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
      decisiveMatch(6, "R4", "X4", "R4", [
        { team1Score: 20, team2Score: 3 },
        { team1Score: 20, team2Score: 3 },
      ]),
      decisiveMatch(7, "R4", "Y4", "R4", [
        { team1Score: 11, team2Score: 9 },
        { team1Score: 11, team2Score: 9 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["P", "Q4", "R4"], matches);
    expect(standings.every((row) => row.wins === 2)).toBe(true);
    // P resolves alone at level 1 (its only head-to-head game, a win over Q4).
    expect(standings[0]!.teamId).toBe("P");
    // Q4 and R4 never played each other, so level 1 can't separate them
    // (both 0 head-to-head wins) — resolved at level 2 by point
    // differential: Q4 = -22 + 18 + 12 = +8, R4 = 34 + 4 = +38.
    expect(standings[1]!.teamId).toBe("R4");
    expect(standings[2]!.teamId).toBe("Q4");
    expect(standings.every((row) => !row.tiedAfterAllTiebreakers)).toBe(true);
  });

  it("skips tiebreaker 4 when tied for 1st place (no team ranked above)", () => {
    // M and N never play each other, so levels 1 and 3 (both
    // head-to-head) are trivially tied at 0. Point differential
    // (level 2) is engineered equal too. Since this IS the top group,
    // there's no "next-highest team" for level 4 — must skip straight
    // to level 5 (total points scored), where M and N finally differ.
    const matches: StandingsMatchInput[] = [
      decisiveMatch(1, "M5", "Z5", "M5", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(2, "N5", "W5", "N5", [
        { team1Score: 13, team2Score: 2 },
        { team1Score: 13, team2Score: 2 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["M5", "N5"], matches);
    expect(standings.every((row) => row.wins === 1)).toBe(true);
    expect(standings.every((row) => row.pointDifferential === 22)).toBe(true);
    // pointsFor: M5 = 22, N5 = 26 — level 5 is what actually resolves this.
    expect(standings.map((row) => row.teamId)).toEqual(["N5", "M5"]);
    expect(standings.every((row) => !row.tiedAfterAllTiebreakers)).toBe(true);
  });

  it("skips tiebreaker 4 when a tied team never played the reference team", () => {
    // TOP clearly outranks U/V (3 wins vs. 1 each), so TOP is the
    // "next-highest team" once U and V tie. U played TOP (and lost);
    // V never played TOP at all — level 4 can't fairly compare them
    // (V's value is undefined, not zero), so it must skip to level 5.
    const matches: StandingsMatchInput[] = [
      decisiveMatch(1, "TOP", "U6", "TOP", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(2, "TOP", "W6", "TOP", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(3, "TOP", "X6", "TOP", [
        { team1Score: 11, team2Score: 0 },
        { team1Score: 11, team2Score: 0 },
      ]),
      decisiveMatch(4, "U6", "W6b", "U6", [
        { team1Score: 20, team2Score: 3 },
        { team1Score: 20, team2Score: 3 },
      ]),
      decisiveMatch(5, "V6", "W7", "V6", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["TOP", "U6", "V6"], matches);
    expect(standings[0]!.teamId).toBe("TOP");
    expect(standings[0]!.wins).toBe(3);
    expect(standings.filter((row) => row.teamId !== "TOP").every((row) => row.wins === 1)).toBe(true);
    // U6 pointDiff: -22 (lost to TOP) + 34 (beat W6b) = +12.
    // V6 pointDiff: +12 (beat W7 only, never played TOP).
    // Level 2 ties them (both +12); level 3 (h2h, never played) ties
    // them too; level 4 skips (V6 never played TOP); level 5 resolves:
    // U6 pointsFor = 0 + 40 = 40, V6 pointsFor = 22.
    expect(standings[1]!.teamId).toBe("U6");
    expect(standings[2]!.teamId).toBe("V6");
    expect(standings.every((row) => !row.tiedAfterAllTiebreakers)).toBe(true);
  });

  it("flags a genuinely unresolved tie once all five tiebreakers are exhausted", () => {
    // M2 and N2 never play each other or anyone in common, and their
    // single wins carry identical point differentials AND identical
    // points scored — every level ties. Tied for 1st (no team above),
    // so level 4 skips too. Nothing left to distinguish them.
    const matches: StandingsMatchInput[] = [
      decisiveMatch(1, "M2", "Z2", "M2", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
      decisiveMatch(2, "N2", "Z3", "N2", [
        { team1Score: 11, team2Score: 5 },
        { team1Score: 11, team2Score: 5 },
      ]),
    ];

    const standings = calculateRoundRobinStandings(["M2", "N2"], matches);
    expect(standings.every((row) => row.wins === 1)).toBe(true);
    expect(standings.every((row) => row.pointDifferential === 12)).toBe(true);
    expect(standings.every((row) => row.pointsFor === 22)).toBe(true);
    // Both flagged — a real, fully unresolved tie, not silently hidden.
    expect(standings.every((row) => row.tiedAfterAllTiebreakers)).toBe(true);
    // Arbitrary but stable — alphabetical by teamId.
    expect(standings.map((row) => row.teamId)).toEqual(["M2", "N2"]);
  });
});

describe("calculateEliminationStandings", () => {
  it("marks the loser of a single-match round-1 eliminated and the winner champion (round 1 is the final for a 2-team bracket)", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: "B", winnerTeamId: "A", status: "COMPLETED", scores: [] },
    ];

    const standings = calculateEliminationStandings(["A", "B"], matches);
    expect(standings.find((s) => s.teamId === "B")).toEqual({
      teamId: "B",
      status: "ELIMINATED",
      eliminatedInRound: 1,
    });
    expect(standings.find((s) => s.teamId === "A")).toEqual({
      teamId: "A",
      status: "CHAMPION",
      eliminatedInRound: null,
    });
  });

  it("keeps a round-1 winner active (not champion) while round 1 still has other matches in progress", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: "B", winnerTeamId: "A", status: "COMPLETED", scores: [] },
      { round: 1, team1Id: "C", team2Id: "D", winnerTeamId: null, status: "IN_PROGRESS", scores: [] },
    ];

    const standings = calculateEliminationStandings(["A", "B", "C", "D"], matches);
    expect(standings.find((s) => s.teamId === "A")!.status).toBe("ACTIVE");
  });

  it("crowns the winner of the final round champion", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: "B", winnerTeamId: "A", status: "COMPLETED", scores: [] },
      { round: 1, team1Id: "C", team2Id: "D", winnerTeamId: "C", status: "COMPLETED", scores: [] },
      { round: 2, team1Id: "A", team2Id: "C", winnerTeamId: "A", status: "COMPLETED", scores: [] },
    ];

    const standings = calculateEliminationStandings(["A", "B", "C", "D"], matches);
    expect(standings.find((s) => s.teamId === "A")!.status).toBe("CHAMPION");
    expect(standings.find((s) => s.teamId === "C")!.status).toBe("ELIMINATED");
    expect(standings.find((s) => s.teamId === "B")!.status).toBe("ELIMINATED");
    expect(standings.find((s) => s.teamId === "D")!.status).toBe("ELIMINATED");
  });

  it("treats a bye as advancing (active), not eliminated", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: null, winnerTeamId: "A", status: "COMPLETED", scores: [] },
      { round: 1, team1Id: "B", team2Id: "C", winnerTeamId: "B", status: "COMPLETED", scores: [] },
    ];

    const standings = calculateEliminationStandings(["A", "B", "C"], matches);
    expect(standings.find((s) => s.teamId === "A")!.status).toBe("ACTIVE");
  });

  it("leaves an in-progress round's teams as active", () => {
    const matches: StandingsMatchInput[] = [
      { round: 1, team1Id: "A", team2Id: "B", winnerTeamId: null, status: "IN_PROGRESS", scores: [] },
    ];

    const standings = calculateEliminationStandings(["A", "B"], matches);
    expect(standings.every((s) => s.status === "ACTIVE")).toBe(true);
  });
});
