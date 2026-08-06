import { generateShortCode } from "@/services/booking/booking-short-code";

const SAFE_ALPHABET = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/;
const AMBIGUOUS_CHARS = ["0", "O", "1", "I", "L"];

describe("generateShortCode", () => {
  it("is always 5 characters from the safe alphabet", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateShortCode()).toMatch(SAFE_ALPHABET);
    }
  });

  it("never contains an ambiguous character (0/O, 1/I/L)", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateShortCode();
      for (const char of AMBIGUOUS_CHARS) {
        expect(code).not.toContain(char);
      }
    }
  });

  it("produces varied output, not a constant value", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateShortCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
