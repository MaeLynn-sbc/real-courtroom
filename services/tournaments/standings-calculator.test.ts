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
