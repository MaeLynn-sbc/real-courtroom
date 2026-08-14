import { firstNameOnly, joinNamesForSpeech, teamNamesForSpeech } from "./match-announcement";

function team(player1Name: string | null, player2Name?: string | null) {
  return {
    player1: { user: { name: player1Name, email: null } },
    player2: player2Name !== undefined ? { user: { name: player2Name, email: null } } : null,
  } as never;
}

describe("firstNameOnly", () => {
  it("drops a trailing last-initial or last name", () => {
    expect(firstNameOnly("Mae Tan")).toBe("Mae");
  });

  it("takes the part before @ for an email fallback", () => {
    expect(firstNameOnly("mae.tan@example.com")).toBe("mae.tan");
  });
});

describe("joinNamesForSpeech", () => {
  it("joins a doubles pair with 'and'", () => {
    expect(joinNamesForSpeech(["Mae", "Jane"])).toBe("Mae and Jane");
  });

  it("returns a singles name as-is", () => {
    expect(joinNamesForSpeech(["Mae"])).toBe("Mae");
  });
});

describe("teamNamesForSpeech", () => {
  it("speaks bare first names only for a doubles team", () => {
    expect(teamNamesForSpeech(team("Mae Tanaka", "Jane Cruz"))).toBe("Mae and Jane");
  });

  it("speaks a singles team as one name", () => {
    expect(teamNamesForSpeech(team("Mae Tanaka"))).toBe("Mae");
  });

  it("returns an empty string for a bye (no team)", () => {
    expect(teamNamesForSpeech(null)).toBe("");
  });
});
