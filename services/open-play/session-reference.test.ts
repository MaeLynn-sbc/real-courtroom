import { formatSessionReference } from "@/services/open-play/session-reference";

describe("formatSessionReference", () => {
  it("formats the date and zero-pads the sequence to 4 digits", () => {
    expect(formatSessionReference(new Date(2026, 6, 20), 1)).toBe("OP-20260720-0001");
  });

  it("pads single-digit months and days", () => {
    expect(formatSessionReference(new Date(2026, 0, 5), 1)).toBe("OP-20260105-0001");
  });

  it("does not truncate a sequence beyond 4 digits", () => {
    expect(formatSessionReference(new Date(2026, 6, 20), 12345)).toBe("OP-20260720-12345");
  });
});
