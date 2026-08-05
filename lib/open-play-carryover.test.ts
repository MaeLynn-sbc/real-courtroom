import { shouldShowCarryoverBanner } from "@/lib/open-play-carryover";

describe("shouldShowCarryoverBanner", () => {
  it("shows the banner when today has no tabs and yesterday has an OPEN one", () => {
    expect(shouldShowCarryoverBanner(0, ["OPEN"])).toBe(true);
  });

  it("shows the banner when yesterday has a mix of statuses including OPEN", () => {
    expect(shouldShowCarryoverBanner(0, ["SETTLED", "WRITTEN_OFF", "OPEN"])).toBe(true);
  });

  it("hides the banner when today already has tabs, regardless of yesterday", () => {
    expect(shouldShowCarryoverBanner(3, ["OPEN"])).toBe(false);
  });

  it("hides the banner when yesterday has no OPEN tabs", () => {
    expect(shouldShowCarryoverBanner(0, ["SETTLED", "WRITTEN_OFF"])).toBe(false);
  });

  it("hides the banner when yesterday has no tabs at all", () => {
    expect(shouldShowCarryoverBanner(0, [])).toBe(false);
  });
});
