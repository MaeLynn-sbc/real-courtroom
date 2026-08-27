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
  });

  // Venue policy: once paid, non-refundable and non-cancellable. Stated in
  // the confirmation itself so the customer reads it at the moment they
  // commit, not afterwards.
  it("states the non-refundable policy on both customer confirmations", () => {
    const byName = Object.fromEntries(TEMPLATE_SAMPLES.map((t) => [t.name, t.body]));
    expect(byName.openPlayConfirmation).toContain("Non-refundable.");
    expect(byName.bookingConfirmation).toContain("Non-refundable.");
    // Coach-facing: the coach is not the payer, so the policy is not theirs.
    expect(byName.coachSession).not.toContain("Non-refundable");
  });

  // Regression guard for the "12:00 AM / wrong day" bug: the open-play
  // time MUST be the session window, and midnight is the tell that
  // registration.date was rendered instead of session.startAt.
  it("renders the open play SESSION window, never a midnight date-only value", () => {
    const body = openPlayConfirmationBody({
      name: "Maria Santos",
      date: "Thu, Aug 27",
      time: "6:00 PM-11:00 PM",
    });
    expect(body).toContain("Thu, Aug 27, 6:00 PM-11:00 PM");
    expect(body).not.toContain("12:00 AM");
    expect(body).not.toContain(" at ");
  });

  it("drops the time cleanly when a registration has no session", () => {
    const body = openPlayConfirmationBody({
      name: "Maria Santos",
      date: "Thu, Aug 27",
      time: "",
    });
    expect(body).toContain("Open Play on Thu, Aug 27. Non-refundable.");
    expect(body).not.toContain(", .");
    expect(analyzeSmsBody(body).segments).toBe(1);
  });

  it("has exactly three templates — no cancellation messages exist", () => {
    expect(TEMPLATE_SAMPLES.map((t) => t.name).sort()).toEqual([
      "bookingConfirmation",
      "coachSession",
      "openPlayConfirmation",
    ]);
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

  // Measured against the LONGEST values actually in production (queried
  // 2026-08-28), not invented ones — that is the only version of this test
  // worth having. Worst real cases leave 17-19 characters of headroom, so
  // any future copy edit has very little room before a name pushes a real
  // customer's message to two segments.
  //   court name       "Court 3"                            7 (all are)
  //   guest name       "Judee Anne Michelle Reposar"       27
  //   open play name   "emmanuel christian jesuzer señeris" 34, with a ñ
  //   longest booking  4 hours
  it("fits one segment at the longest values production actually holds", () => {
    const openPlay = openPlayConfirmationBody({
      name: "emmanuel christian jesuzer señeris",
      date: "Thu, Aug 27",
      time: "6:00 PM-11:00 PM",
    });
    const booking = bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 3",
      date: "Wed Sep 10",
      time: "10:00 AM-2:00 PM",
    });

    for (const body of [openPlay, booking]) {
      const a = analyzeSmsBody(body);
      expect(a.encoding).toBe("GSM-7");
      expect(a.segments).toBe(1);
      expect(a.length).toBeLessThanOrEqual(160);
    }
    // The n-tilde in that real name is in the GSM-7 basic set. Asserted so
    // nobody "fixes" it by stripping accents from a customer's own name.
    expect(analyzeSmsBody(openPlay).offendingCharacters).toEqual([]);
    // Headroom, pinned so a copy edit that eats it fails HERE rather than
    // on a customer's handset. Owner accepted the tighter open-play margin
    // when choosing the full session range over a lone start time:
    //     open play  148/160  ->  12 spare   (longest real name, 34 chars)
    //     booking    143/160  ->  17 spare
    // 10 is the floor below which a slightly longer name would split.
    expect(160 - analyzeSmsBody(openPlay).length).toBeGreaterThanOrEqual(10);
    expect(160 - analyzeSmsBody(booking).length).toBeGreaterThanOrEqual(15);
  });

  it("flips to two segments when an acute-accented name is substituted", () => {
    // Documented cost, not a bug — asserted so the behaviour is known.
    const body = bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
    });
    // Asserted as "costs MORE", not pinned to a number — the exact segment
    // count moves whenever the copy changes, and pinning it makes an
    // unrelated wording edit fail here for the wrong reason.
    const clean = analyzeSmsBody(body);
    const forced = analyzeSmsBody(body.replace("Court 2", "Concepción"));
    expect(clean.segments).toBe(1);
    expect(forced.encoding).toBe("UCS-2");
    expect(forced.segments).toBeGreaterThan(clean.segments);
  });
});
