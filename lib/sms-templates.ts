import { analyzeSmsBody } from "@/lib/sms-encoding";

// The three customer/coach-facing message bodies.
//
// NO VENUE PREFIX (owner decision, 2026-08-28). The Semaphore sender name
// is CourtroomPH, so every message already arrives labelled — a leading
// "The Courtroom Kalibo:" repeats it, and repeats it inside the 160
// characters we are paying for.
//
// NO "REPLY HERE" — EVER (owner finding, 2026-08-28, from the first live
// send). Semaphore sender names are ONE-WAY: the handset displays
// "sender cannot accept replies" underneath the message. Any instruction
// to reply promises a channel that does not exist, and on the open-play
// template it was asking for a CANCELLATION down a dead line — the worst
// case, because the customer believes they have cancelled and the seat
// stays held.
//
// NO CANCELLATION MESSAGES EXIST (owner policy, 2026-08-28): once paid,
// a booking is non-refundable and cannot be cancelled, so there is no
// cancellation event to tell anyone about. The two cancellation templates
// and their triggers were removed rather than left unused.
//
// Owner decision (2026-08-28, after the second live read): end on a
// FRIENDLY CLOSER rather than contact details. A confirmation is a nice
// moment, not a support ticket, and a phone number in every message
// invites calls the venue does not want to field. No reply instruction,
// no phone, no URL — the cancellation route lives on the confirmation
// page and in the customer's own records, not stapled to every text.
//
// GSM-7 DISCIPLINE. Straight quotes and apostrophes only; ":" and "-"
// instead of the em dash that forced UCS-2 in the first drafts. Ordinary
// ASCII throughout — the only characters that can push these to UCS-2 are
// the substituted values (a customer named Ramirez with an acute accent),
// which lib/sms-encoding.ts catches on the RENDERED body at send time.
//
// The template bodies themselves are asserted single-segment GSM-7 in
// lib/sms-templates.test.ts, so an edit that quietly doubles the bill
// fails the suite rather than the invoice.

export interface OpenPlayConfirmationValues {
  name: string;
  date: string;
  /**
   * The session's full window, e.g. "6:00 PM-11:00 PM".
   *
   * MUST come from OpenPlayNightSession.startAt/endAt, never from
   * OpenPlayNightRegistration.date. That column is a date-only marker
   * pinned to midnight: rendering it as a time produced "12:00 AM", and
   * because midnight Manila falls on the next calendar day it named the
   * wrong DAY too — a Thursday night went out as "Fri, Aug 28".
   *
   * Open play is a five-hour drop-in window, so the range is the useful
   * thing to state; a lone start time reads like something to be late for.
   */
  time: string;
}

export function openPlayConfirmationBody(v: OpenPlayConfirmationValues): string {
  // Blank time drops the clause entirely rather than leaving a dangling
  // ", ." — reached only if a registration somehow has no session.
  const when = v.time.trim() ? `${v.date}, ${v.time}` : v.date;
  return `Hi ${v.name}, you're booked for Open Play on ${when}. Non-refundable. Thank you and see you in court!`;
}

export interface BookingConfirmationValues {
  shortCode: string;
  court: string;
  date: string;
  time: string;
}

export function bookingConfirmationBody(v: BookingConfirmationValues): string {
  return `Booking ${v.shortCode} confirmed: ${v.court}, ${v.date}, ${v.time}. Show this code when you arrive. Non-refundable. Thank you and see you in court!`;
}

export interface CoachSessionValues {
  customer: string;
  date: string;
  time: string;
  court: string;
}

export function coachSessionBody(v: CoachSessionValues): string {
  return `New session: ${v.customer}, ${v.date}, ${v.time}, ${v.court}. Check the dashboard for details.`;
}

// Exported for the test, which walks every template with representative
// values and asserts each one is single-segment GSM-7.
export const TEMPLATE_SAMPLES: { name: string; body: string }[] = [
  {
    name: "openPlayConfirmation",
    body: openPlayConfirmationBody({
      name: "Maria Santos",
      date: "Thu, Aug 27",
      time: "6:00 PM-11:00 PM",
    }),
  },
  {
    name: "bookingConfirmation",
    body: bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
    }),
  },
  {
    name: "coachSession",
    body: coachSessionBody({
      customer: "Maria Santos",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
      court: "Court 2",
    }),
  },
];

export function describeTemplate(body: string): string {
  const a = analyzeSmsBody(body);
  return `${a.encoding} ${a.length} chars ${a.segments} segment(s)`;
}
