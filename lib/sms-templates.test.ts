import { analyzeSmsBody } from "@/lib/sms-encoding";
import {
  TEMPLATE_SAMPLES,
  bookingConfirmationBody,
  openPlayConfirmationBody,
} from "@/lib/sms-templates";

describe("SMS templates", () => {
  it.each(TEMPLATE_SAMPLES.map((s) => [s.name, s.body]))(
    "%s renders as single-segment GSM-7",
    (_name, body) => {
      const a = analyzeSmsBody(body);
      expect(a.offendingCharacters).toEqual([]);
      expect(a.encoding).toBe("GSM-7");
      expect(a.segments).toBe(1);
      expect(a.length).toBeLessThanOrEqual(160);
    },
  );

  it("carries no venue prefix — the sender name already says CourtroomPH", () => {
    for (const { body } of TEMPLATE_SAMPLES) {
      expect(body).not.toMatch(/The Courtroom/i);
    }
  });

  it("uses straight apostrophes only — a curly one would force UCS-2", () => {
    for (const { body } of TEMPLATE_SAMPLES) {
      expect(body).not.toMatch(/[‘’“”–—]/);
    }
  });

  it("still fits one segment with long realistic values", () => {
    const body = openPlayConfirmationBody({
      name: "Bernadette Villanueva",
      date: "Wednesday Aug 28",
      time: "7:00 PM",
    });
    expect(analyzeSmsBody(body).segments).toBe(1);
  });

  it("flips to two segments when an acute-accented name is substituted", () => {
    // Documented cost, not a bug — asserted so the behaviour is known.
    const body = bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
    });
    expect(analyzeSmsBody(body).segments).toBe(1);
    expect(analyzeSmsBody(body.replace("Court 2", "Concepción")).segments).toBe(2);
  });
});
