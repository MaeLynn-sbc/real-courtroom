import { analyzeSmsBody } from "@/lib/sms-encoding";

// The five customer/coach-facing message bodies.
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
// Every template now ends in a route that actually works:
//   open play    -> /open-play/cancel   (self-service; asks for phone +
//                   night, no code needed, so the text needs no reference)
//   bookings     -> the venue phone
//   coaches      -> the dashboard they already use
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
  time: string;
}

// The cancel page asks only for phone number + night, so this can send
// customers straight there with nothing to quote back.
const OPEN_PLAY_CANCEL_URL = "thecourtroomkalibo.com/open-play/cancel";

// Rendered EXACTLY as stored in cms.business.info (spaces and all —
// "0962 857 2974" reads better on a handset than a normalised string, and
// every phone dialer copes with the spaces).
//
// Passed in by the caller rather than read here, so these stay pure
// functions the tests can measure. The consequence the owner called out:
// a longer contact value can push a body past 160, so the encoding check
// runs on the RENDERED string at send time (sms-dispatch.service.ts), not
// on the template.
//
// A blank phone drops the whole clause instead of emitting "Call ." —
// cms.business.info's other fields are empty in production, so an empty
// phone is a real state, not a hypothetical.
function contactClause(phone: string, lead: string): string {
  const trimmed = phone.trim();
  return trimmed ? ` ${lead} ${trimmed}.` : "";
}

export function openPlayConfirmationBody(v: OpenPlayConfirmationValues): string {
  return `Hi ${v.name}, you're booked for Open Play on ${v.date} at ${v.time}. Can't make it? Cancel at ${OPEN_PLAY_CANCEL_URL}`;
}

export interface BookingConfirmationValues {
  shortCode: string;
  court: string;
  date: string;
  time: string;
  /** cms.business.info -> phone, verbatim. Blank drops the clause. */
  contactPhone: string;
}

export function bookingConfirmationBody(v: BookingConfirmationValues): string {
  return `Booking ${v.shortCode} confirmed: ${v.court}, ${v.date}, ${v.time}. Show this code when you arrive.${contactClause(v.contactPhone, "Questions? Call")}`;
}

export interface BookingCancellationValues {
  shortCode: string;
  date: string;
  time: string;
  /** cms.business.info -> phone, verbatim. Blank drops the clause. */
  contactPhone: string;
}

export function bookingCancellationBody(v: BookingCancellationValues): string {
  return `Booking ${v.shortCode} on ${v.date}, ${v.time} has been cancelled.${contactClause(v.contactPhone, "Not expecting this? Call")}`;
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

export function coachSessionCancelledBody(v: CoachSessionValues): string {
  return `Cancelled: your session with ${v.customer} on ${v.date}, ${v.time}, ${v.court} is no longer booked.`;
}

// Exported for the test, which walks every template with representative
// values and asserts each one is single-segment GSM-7.
export const TEMPLATE_SAMPLES: { name: string; body: string }[] = [
  {
    name: "openPlayConfirmation",
    body: openPlayConfirmationBody({ name: "Maria Santos", date: "Fri Aug 28", time: "7:00 PM" }),
  },
  {
    name: "bookingConfirmation",
    body: bookingConfirmationBody({
      shortCode: "5GTWU",
      court: "Court 2",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
      contactPhone: "0962 857 2974",
    }),
  },
  {
    name: "bookingCancellation",
    body: bookingCancellationBody({
      shortCode: "5GTWU",
      date: "Fri Aug 28",
      time: "7:00 PM-8:00 PM",
      contactPhone: "0962 857 2974",
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
  {
    name: "coachSessionCancelled",
    body: coachSessionCancelledBody({
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
