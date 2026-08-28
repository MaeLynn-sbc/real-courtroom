import { analyzeSmsBody } from "@/lib/sms-encoding";
import { smsDate, smsTime, smsTimeRange, smsTruncateReason } from "@/lib/sms-format";

// These pin the ONE property that caused two separate bugs in this build:
// every timestamp reaching an SMS is a naive-UTC value that Prisma hands
// back as a UTC instant, and it must be rendered in Asia/Manila (UTC+8).
//
// Without these, dropping the timeZone option would shift every message
// by eight hours — turning a 7 PM booking into 11 AM — and no other test
// in the suite would notice.
describe("SMS date/time formatting", () => {
  describe("renders in Asia/Manila regardless of server timezone", () => {
    // Raw hours observed in production for Booking.startAt span 23:00-14:00,
    // which plus the +8 offset is 7 AM - 10 PM: exactly the court operating
    // window. That is the proof these are naive-UTC instants.
    it.each([
      ["2026-08-27T23:00:00Z", "7:00 AM", "the earliest bookable slot"],
      ["2026-08-28T03:00:00Z", "11:00 AM", "late morning"],
      ["2026-08-28T11:00:00Z", "7:00 PM", "the evening peak"],
      ["2026-08-28T14:00:00Z", "10:00 PM", "the latest bookable slot"],
      ["2026-08-27T10:00:00Z", "6:00 PM", "open play session start"],
      ["2026-08-27T15:00:00Z", "11:00 PM", "open play session end"],
    ])("%s renders as %s (%s)", (iso, expected) => {
      expect(smsTime(new Date(iso))).toBe(expected);
    });

    it("rolls the DATE forward across the UTC-to-Manila boundary", () => {
      // 23:00 UTC on the 27th is 7 AM on the 28th in Manila. Getting this
      // wrong is what made a Thursday open-play night go out as Friday.
      expect(smsDate(new Date("2026-08-27T23:00:00Z"))).toBe("Fri, Aug 28");
      expect(smsDate(new Date("2026-08-27T15:59:00Z"))).toBe("Thu, Aug 27");
    });

    it("keeps an open play session on its own night", () => {
      // 10:00 UTC = 6 PM Manila, same calendar day. The session row is the
      // correct source precisely because it does NOT sit at midnight.
      const start = new Date("2026-08-27T10:00:00Z");
      expect(smsDate(start)).toBe("Thu, Aug 27");
      expect(smsTime(start)).toBe("6:00 PM");
    });

    it("shows why registration.date is the WRONG source", () => {
      // Stored midnight-Manila for the Thursday night. Rendered as a time
      // it is meaningless, and its date has already tipped into Friday.
      const dateOnly = new Date("2026-08-27T16:00:00Z");
      expect(smsTime(dateOnly)).toBe("12:00 AM");
      expect(smsDate(dateOnly)).toBe("Fri, Aug 28");
    });
  });

  describe("smsTimeRange", () => {
    it("joins with a HYPHEN, never an en dash", () => {
      const range = smsTimeRange(
        new Date("2026-08-28T11:00:00Z"),
        new Date("2026-08-28T12:00:00Z"),
      );
      expect(range).toBe("7:00 PM-8:00 PM");
      // An en dash here would force UCS-2 and halve every message.
      expect(range).not.toMatch(/[–—]/);
    });

    it("renders the full open play window", () => {
      expect(
        smsTimeRange(new Date("2026-08-27T10:00:00Z"), new Date("2026-08-27T15:00:00Z")),
      ).toBe("6:00 PM-11:00 PM");
    });

    it("spans midnight without losing the end time", () => {
      expect(
        smsTimeRange(new Date("2026-08-28T15:00:00Z"), new Date("2026-08-28T16:00:00Z")),
      ).toBe("11:00 PM-12:00 AM");
    });
  });

  it("emits only GSM-7-safe characters", () => {
    const rendered = [
      smsDate(new Date("2026-08-28T11:00:00Z")),
      smsTime(new Date("2026-08-28T11:00:00Z")),
      smsTimeRange(new Date("2026-08-28T11:00:00Z"), new Date("2026-08-28T12:00:00Z")),
    ].join(" ");
    // Intl can emit narrow no-break spaces (U+202F) before AM/PM in some
    // ICU versions — that is NOT GSM-7 and would silently double the bill.
    expect(rendered).not.toMatch(/[  –—]/);
  });
  // Staff type rejection reasons as unbounded free text. Before the cap,
  // the booking rejection billed FIVE segments; a long reason alone was
  // enough to double even a GSM-7 body.
  describe("smsTruncateReason", () => {
    it("leaves a short reason untouched", () => {
      expect(smsTruncateReason("the reference number didn't match", 38)).toBe(
        "the reference number didn't match",
      );
    });

    it("cuts a long reason on a word boundary", () => {
      const out = smsTruncateReason(
        "the reference number you sent does not match any GCash transaction we received",
        38,
      );
      expect(out.length).toBeLessThanOrEqual(38);
      expect(out.endsWith("...")).toBe(true);
      expect(out).not.toMatch(/\s\.\.\.$/); // no space before the dots
    });

    it("closes with three dots, NOT the ellipsis character", () => {
      const out = smsTruncateReason("x".repeat(80), 38);
      // U+2026 is outside GSM-7 and would force UCS-2 — defeating the cap.
      expect(out).not.toContain("\u2026");
      expect(analyzeSmsBody(out).encoding).toBe("GSM-7");
    });

    it("collapses whitespace so a pasted multi-line reason stays one line", () => {
      expect(smsTruncateReason("  bad\n\n  reference  ", 38)).toBe("bad reference");
    });

    it("keeps both rejection bodies inside one GSM-7 segment at any length", () => {
      const long = "the reference number you sent does not match any GCash transaction we received for this date and amount, please check your receipt";
      const bodies = [
        `Open Play payment could not be verified: ${smsTruncateReason(long, 38)}. Your registration is cancelled. Please register again if you'd like to join.`,
        `Booking 5GTWU payment could not be verified: ${smsTruncateReason(long, 38)}. The booking is cancelled. Please book again if you'd like to play.`,
      ];
      for (const body of bodies) {
        const a = analyzeSmsBody(body);
        expect(a.encoding).toBe("GSM-7");
        expect(a.segments).toBe(1);
      }
    });
  });
});
