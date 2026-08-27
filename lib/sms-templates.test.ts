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

  it("points somewhere that actually works instead", () => {
    const byName = Object.fromEntries(TEMPLATE_SAMPLES.map((t) => [t.name, t.body]));
    // Self-service cancellation — the page matches on phone + night and is
    // restricted to source WEBSITE, which is exactly who gets this text.
    expect(byName.openPlayConfirmation).toContain("/open-play/cancel");
    expect(byName.bookingConfirmation).toContain("0962 857 2974");
    expect(byName.bookingCancellation).toContain("0962 857 2974");
    // Coach-facing messages point at the dashboard those users already have.
    expect(byName.coachSession).toContain("dashboard");
  });

  // The contact number is read from cms.business.info at render time, so a
  // longer one is a real way to blow the single-segment budget. The
  // dispatcher analyses the RENDERED body for exactly this reason.
  it("survives a longer contact number, and a blank one drops the clause", () => {
    const long = bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
      contactPhone: "+63 962 857 2974 / +63 917 000 1234",
    });
    expect(analyzeSmsBody(long).segments).toBe(1);

    const blank = bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
      contactPhone: "",
    });
    expect(blank).not.toContain("Call");
    expect(blank.trimEnd()).toBe(blank);
    expect(analyzeSmsBody(blank).segments).toBe(1);
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
      contactPhone: "0962 857 2974",
    });
    expect(analyzeSmsBody(body).segments).toBe(1);
    expect(analyzeSmsBody(body.replace("Court 2", "Concepción")).segments).toBe(2);
  });
});
