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

  // Owner finding from the first live send (2026-08-28): Semaphore sender
  // names are ONE-WAY. The handset shows "sender cannot accept replies"
  // under every message, so any instruction to reply promises a channel
  // that does not exist. On the open-play template it was soliciting a
  // CANCELLATION down a dead line, which is the worst case: the customer
  // believes they have cancelled and the seat stays held.
  it("never instructs the customer to reply", () => {
    for (const { name, body } of TEMPLATE_SAMPLES) {
      expect(`${name}: ${body}`).not.toMatch(/reply/i);
    }
  });

  // The closers carry the only two characters worth re-checking: "!" and
  // the straight apostrophe. Both ARE in the GSM 03.38 basic set, but the
  // point of this suite is not to trust that — it is to measure it.
  it("ends every customer template with a friendly closer, not an instruction", () => {
    const byName = Object.fromEntries(TEMPLATE_SAMPLES.map((t) => [t.name, t.body]));
    expect(byName.openPlayConfirmation).toContain("Thank you and see you in court!");
    expect(byName.bookingConfirmation).toContain("Thank you and see you in court!");
    // A cancellation cannot say "see you in court" — nobody is coming.
    expect(byName.bookingCancellation).toContain("hope to see you in court again soon");
    expect(byName.bookingCancellation).not.toContain("see you in court!");
  });

  it("carries no contact details at all — no phone, no URL", () => {
    for (const { name, body } of TEMPLATE_SAMPLES) {
      expect(`${name}: ${body}`).not.toMatch(/\d{4}\s?\d{3}\s?\d{4}/); // a phone number
      expect(`${name}: ${body}`).not.toMatch(/https?:|www\.|\.com/i); // a URL
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
