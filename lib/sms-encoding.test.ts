import { analyzeSmsBody, isSingleSegmentGsm7 } from "@/lib/sms-encoding";

describe("analyzeSmsBody", () => {
  describe("GSM-7 detection and septet counting", () => {
    it("counts plain ASCII one septet per character", () => {
      const result = analyzeSmsBody("Booking 5GTWU confirmed");
      expect(result.encoding).toBe("GSM-7");
      expect(result.length).toBe(23);
      expect(result.segments).toBe(1);
      expect(result.offendingCharacters).toEqual([]);
    });

    it("charges extension-table characters TWO septets", () => {
      // Both are GSM-7, but "{" costs an escape byte as well.
      expect(analyzeSmsBody("a").length).toBe(1);
      expect(analyzeSmsBody("{").length).toBe(2);
      expect(analyzeSmsBody("€").length).toBe(2);
    });

    it("treats the peso-free currency and punctuation we actually use as GSM-7", () => {
      expect(analyzeSmsBody("Court 2, Fri Aug 28, 7:00 PM-8:00 PM.").encoding).toBe("GSM-7");
    });
  });

  describe("the em dash trap — the reason this module exists", () => {
    it("flags an em dash as forcing UCS-2", () => {
      const result = analyzeSmsBody("Booking 5GTWU confirmed — Court 2");
      expect(result.encoding).toBe("UCS-2");
      expect(result.offendingCharacters).toEqual(["—"]);
    });

    it("flags a curly apostrophe, which a copy-paste introduces silently", () => {
      const result = analyzeSmsBody("you’re booked");
      expect(result.encoding).toBe("UCS-2");
      expect(result.offendingCharacters).toEqual(["’"]);
    });

    it("accepts the straight apostrophe we standardised on", () => {
      expect(analyzeSmsBody("you're booked").encoding).toBe("GSM-7");
    });

    it("flags an en dash — the one hiding in pageConfirmationCopy", () => {
      expect(analyzeSmsBody("7AM–11PM").encoding).toBe("UCS-2");
    });
  });

  describe("rendered-body substitution — a clean template is not enough", () => {
    const template = (name: string) =>
      `Hi ${name}, you're booked for Open Play on Fri Aug 28 at 7:00 PM. See you on the court!`;

    it("stays GSM-7 for an unaccented name", () => {
      const result = analyzeSmsBody(template("Maria"));
      expect(result.encoding).toBe("GSM-7");
      expect(result.segments).toBe(1);
    });

    // GSM 03.38's basic set carries e-acute, n-tilde, a-grave, o-umlaut and
    // friends — so two of the names most likely to be raised as a worry are
    // in fact free. Asserted explicitly so nobody "fixes" them later by
    // stripping accents from real customers' names for no reason.
    it.each([["José"], ["Peñaflorida"], ["Muñoz"], ["Iñigo"], ["Bañez"]])(
      "keeps %s on GSM-7 — these accents are IN the basic set",
      (name) => {
        const result = analyzeSmsBody(template(name));
        expect(result.encoding).toBe("GSM-7");
        expect(result.segments).toBe(1);
      },
    );

    // The accents that genuinely are NOT in GSM 03.38: acute i, o, u and a.
    it.each([
      ["Ramírez", "í"],
      ["Concepción", "ó"],
      ["Núñez", "ú"],
      ["Rodríguez", "í"],
    ])("flips %s to UCS-2, forced by %s", (name, offender) => {
      const result = analyzeSmsBody(template(name));
      expect(result.encoding).toBe("UCS-2");
      expect(result.offendingCharacters).toContain(offender);
    });

    it("costs a SECOND SEGMENT once UCS-2 is forced at our template length", () => {
      // The template is ~95 chars — comfortably one GSM-7 segment, and
      // instantly two under UCS-2's 70-char ceiling. This is the cost the
      // dispatcher must log rather than absorb silently.
      const clean = analyzeSmsBody(template("Maria"));
      const forced = analyzeSmsBody(template("Concepción"));
      expect(clean.segments).toBe(1);
      expect(forced.length).toBeGreaterThan(70);
      expect(forced.segments).toBe(2);
    });
  });

  describe("segment boundaries", () => {
    it("fits exactly 160 GSM-7 characters in one segment", () => {
      expect(analyzeSmsBody("a".repeat(160)).segments).toBe(1);
    });

    it("splits at 161 using the 153-septet concatenated limit", () => {
      expect(analyzeSmsBody("a".repeat(161)).segments).toBe(2);
      expect(analyzeSmsBody("a".repeat(306)).segments).toBe(2);
      expect(analyzeSmsBody("a".repeat(307)).segments).toBe(3);
    });

    it("fits exactly 70 UCS-2 characters in one segment", () => {
      expect(analyzeSmsBody("ó".repeat(70)).segments).toBe(1);
    });

    it("splits at 71 using the 67-unit concatenated limit", () => {
      expect(analyzeSmsBody("ó".repeat(71)).segments).toBe(2);
    });

    it("counts an astral emoji as TWO UTF-16 units", () => {
      expect(analyzeSmsBody("🎾").length).toBe(2);
      expect(analyzeSmsBody("🎾".repeat(35)).segments).toBe(1);
      expect(analyzeSmsBody("🎾".repeat(36)).segments).toBe(2);
    });

    it("treats an empty body as a single segment", () => {
      expect(analyzeSmsBody("").segments).toBe(1);
    });
  });

  describe("isSingleSegmentGsm7", () => {
    it("is true only for GSM-7 that fits one segment", () => {
      expect(isSingleSegmentGsm7("Court 2, Fri Aug 28.")).toBe(true);
      expect(isSingleSegmentGsm7("Court 2 — Fri Aug 28.")).toBe(false);
      expect(isSingleSegmentGsm7("a".repeat(161))).toBe(false);
    });
  });
});
