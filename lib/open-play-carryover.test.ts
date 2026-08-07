import { shouldShowCarryoverBanner } from "@/lib/open-play-carryover";

describe("shouldShowCarryoverBanner", () => {
  it("shows the banner when yesterday has an OPEN tab", () => {
    expect(shouldShowCarryoverBanner(["OPEN"])).toBe(true);
  });

  it("shows the banner when yesterday has a mix of statuses including OPEN", () => {
    expect(shouldShowCarryoverBanner(["SETTLED", "WRITTEN_OFF", "OPEN"])).toBe(true);
  });

  it("hides the banner when yesterday has no OPEN tabs", () => {
    expect(shouldShowCarryoverBanner(["SETTLED", "WRITTEN_OFF"])).toBe(false);
  });

  it("hides the banner when yesterday has no tabs at all", () => {
    expect(shouldShowCarryoverBanner([])).toBe(false);
  });
});
