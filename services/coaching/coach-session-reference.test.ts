import { formatCoachSessionReference } from "./coach-session-reference";

describe("formatCoachSessionReference", () => {
  it("formats as CS-YYYYMMDD-NNNN, zero-padded", () => {
    expect(formatCoachSessionReference(new Date(2031, 3, 7), 1)).toBe("CS-20310407-0001");
  });

  it("pads the sequence to 4 digits", () => {
    expect(formatCoachSessionReference(new Date(2031, 3, 7), 42)).toBe("CS-20310407-0042");
  });

  it("does not truncate a sequence longer than 4 digits", () => {
    expect(formatCoachSessionReference(new Date(2031, 3, 7), 12345)).toBe("CS-20310407-12345");
  });
});
