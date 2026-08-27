import { normalizePhilippineMobile } from "@/lib/phone";

// Every "accepts" case below is a shape counted in the production audit of
// 2026-08-28; every "rejects" case is a literal value pulled from the
// production tables. Using real values rather than invented ones is the
// point — the normalizer's job is defined by what customers actually typed.
describe("normalizePhilippineMobile", () => {
  describe("the four shapes production actually stores", () => {
    it("passes through the canonical local form (249 open-play, 126 booking rows)", () => {
      expect(normalizePhilippineMobile("09171234567")).toBe("09171234567");
    });

    it("converts +63 international form (7 rows)", () => {
      expect(normalizePhilippineMobile("+639171234567")).toBe("09171234567");
    });

    it("converts bare 63 country code (1 row)", () => {
      expect(normalizePhilippineMobile("639171234567")).toBe("09171234567");
    });

    it("restores a dropped trunk zero (8 rows)", () => {
      expect(normalizePhilippineMobile("9171234567")).toBe("09171234567");
    });
  });

  describe("separator noise (13 rows carry it)", () => {
    it.each([
      ["0917 123 4567", "spaces"],
      ["0917-123-4567", "dashes"],
      ["(0917) 123-4567", "parens and dashes"],
      ["+63 917 123 4567", "spaces inside the international form"],
      ["  09171234567  ", "surrounding whitespace"],
    ])("strips %s (%s)", (input) => {
      expect(normalizePhilippineMobile(input)).toBe("09171234567");
    });
  });

  describe("real junk from production — must return null, never a guess", () => {
    it.each([
      ["1", "831 walk-in rows are a single character"],
      [".", "the literal placeholder staff type to get past the field"],
      ["messenger", "a customer answering with the app they prefer"],
      ["444", "walk-in filler"],
      ["33333", "test-booking filler"],
      ["9959595", "too short"],
      ["0968636847", "a real customer, one digit short"],
      ["099989713110", "a real customer, one digit long"],
      ["094724486823", "a real customer, one digit long"],
      ["0909991528", "a real open-play registrant, one digit short"],
      ["+9995327490", "+999 is not a country code"],
      ["13432432432", "not a PH mobile"],
      ["7567676767", "does not start with 9"],
    ])("rejects %s (%s)", (input) => {
      expect(normalizePhilippineMobile(input)).toBeNull();
    });

    it("rejects a landline — it cannot receive SMS", () => {
      expect(normalizePhilippineMobile("0362621234")).toBeNull();
    });

    it("rejects empty, blank and nullish input", () => {
      expect(normalizePhilippineMobile("")).toBeNull();
      expect(normalizePhilippineMobile("   ")).toBeNull();
      expect(normalizePhilippineMobile(null)).toBeNull();
      expect(normalizePhilippineMobile(undefined)).toBeNull();
    });
  });

  describe("guards against silently manufacturing a valid-looking number", () => {
    it("does not truncate an 11-digit string that happens to start with 63", () => {
      // Without the length guard this would become 0912345678 — a real
      // phone belonging to somebody else entirely.
      expect(normalizePhilippineMobile("63912345678")).toBeNull();
    });

    // OVER-length is the same hazard as the 63-prefix case: 091712345678
    // truncated to 11 digits is a real phone belonging to someone else.
    // The subscriber pattern is anchored to EXACTLY ten digits, so every
    // one of these is rejected rather than trimmed to fit.
    it.each([
      ["091712345678", "12 digits starting 09"],
      ["0917123456789", "13 digits starting 09"],
      ["+6391712345678", "14 digits starting +639"],
      ["639171234567890", "15 digits starting 639"],
      ["91712345678", "11 digits starting 9"],
      ["0917 123 45678", "over-length once separators are stripped"],
    ])("rejects over-length input %s (%s) rather than truncating", (input) => {
      expect(normalizePhilippineMobile(input)).toBeNull();
    });

    it("does not strip letters into digits", () => {
      expect(normalizePhilippineMobile("0917abc4567")).toBeNull();
    });

    it("is idempotent — normalising twice changes nothing", () => {
      const once = normalizePhilippineMobile("+63 917 123 4567");
      expect(normalizePhilippineMobile(once)).toBe(once);
    });
  });
});
