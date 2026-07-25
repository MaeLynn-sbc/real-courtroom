import { generateTempPassword } from "@/lib/temp-password";

describe("generateTempPassword", () => {
  it("generates a 12-character password", () => {
    expect(generateTempPassword()).toHaveLength(12);
  });

  it("only uses unambiguous alphanumeric characters (no 0/O, 1/I/l)", () => {
    expect(generateTempPassword()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]+$/);
  });

  it("generates a different password on each call", () => {
    const passwords = new Set(Array.from({ length: 20 }, () => generateTempPassword()));
    expect(passwords.size).toBe(20);
  });
});
