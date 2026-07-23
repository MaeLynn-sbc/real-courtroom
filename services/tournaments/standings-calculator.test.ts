import {
  calculateEliminationStandings,
  calculateRoundRobinStandings,
  type StandingsMatchInput,
} from "@/services/tournaments/standings-calculator";

describe("calculateRoundRobinStandings", () => {
  it("ranks teams by wins then set differential", () => {
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
