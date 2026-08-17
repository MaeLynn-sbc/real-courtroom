import { looksLikeCuid, slugifyTournamentName } from "./tournament-slug";

// These rules are duplicated in migration 74's SQL (it backfills existing
// rows with the same shape). If a case here changes, that SQL has to change
// with it, or a pre-migration and post-migration tournament of the same name
// end up with different URLs.
describe("slugifyTournamentName", () => {
  it("slugifies the real tournament name that prompted this", () => {
    expect(slugifyTournamentName("Sayans and Friends Pickleball Tournament")).toBe(
      "sayans-and-friends-pickleball-tournament",
    );
  });

  it("collapses every run of non-alphanumerics into a single dash", () => {
    expect(slugifyTournamentName("Summer  Open --  2026!!")).toBe("summer-open-2026");
  });

  it("trims leading and trailing separators", () => {
    expect(slugifyTournamentName("  ...Spring Classic...  ")).toBe("spring-classic");
  });

  it("folds accents to their base letters instead of dropping them", () => {
    expect(slugifyTournamentName("Ñito Memorial Cup")).toBe("nito-memorial-cup");
  });

  it("falls back rather than returning an empty slug", () => {
    expect(slugifyTournamentName("!!!")).toBe("tournament");
    expect(slugifyTournamentName("")).toBe("tournament");
  });

  it("truncates long names without leaving a trailing dash", () => {
    const slug = slugifyTournamentName(`${"a".repeat(78)} bcdef`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("looksLikeCuid", () => {
  it("recognises a Prisma cuid so pre-slug links still resolve", () => {
    expect(looksLikeCuid("clx8f2a9k0001abcdefghijklm")).toBe(false);
    expect(looksLikeCuid("c" + "a".repeat(24))).toBe(true);
  });

  it("does not mistake a readable slug for an id", () => {
    expect(looksLikeCuid("sayans-and-friends-pickleball-tournament")).toBe(false);
    expect(looksLikeCuid("summer-open")).toBe(false);
  });
});
