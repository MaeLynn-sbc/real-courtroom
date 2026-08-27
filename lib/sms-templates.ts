import { analyzeSmsBody } from "@/lib/sms-encoding";

// The five customer/coach-facing message bodies.
//
// NO VENUE PREFIX (owner decision, 2026-08-28). The Semaphore sender name
// is CourtroomPH, so every message already arrives labelled — a leading
// "The Courtroom Kalibo:" repeats it, and repeats it inside the 160
// characters we are paying for.
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

export function openPlayConfirmationBody(v: OpenPlayConfirmationValues): string {
  return `Hi ${v.name}, you're booked for Open Play on ${v.date} at ${v.time}. See you on the court! Reply here if you can't make it.`;
}

export interface BookingConfirmationValues {
  shortCode: string;
  court: string;
  date: string;
  time: string;
}

export function bookingConfirmationBody(v: BookingConfirmationValues): string {
  return `Booking ${v.shortCode} confirmed: ${v.court}, ${v.date}, ${v.time}. Show this code when you arrive. Questions? Reply here.`;
}

export interface BookingCancellationValues {
  shortCode: string;
  date: string;
  time: string;
}

export function bookingCancellationBody(v: BookingCancellationValues): string {
  return `Booking ${v.shortCode} on ${v.date}, ${v.time} has been cancelled. Reply here if this is unexpected and we'll sort it out.`;
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
    }),
  },
  {
    name: "bookingCancellation",
    body: bookingCancellationBody({
      shortCode: "5GTWU",
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
