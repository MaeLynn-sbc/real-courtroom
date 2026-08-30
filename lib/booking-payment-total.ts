import type { CoachSessionStatus } from "@/lib/generated/prisma/enums";

export interface BookingWithOptionalCoachSession {
  totalAmountCents: number | null;
  coachSession: { status: CoachSessionStatus; rateCents: number; hours: number } | null;
}

// The single source of truth for "what does this booking actually owe,
// including any coach add-on." Every consumer MUST call this rather than
// summing totalAmountCents + a coach fee itself — calling this function
// is what keeps them agreeing, not a property of the app's structure.
// Reported live 2026-08-04 (Bea Señeris, BK-20260804-0002): a stale
// version of this same comment once claimed the customer-facing total
// and the staff verification screen "can never disagree" — false. The
// verification QUEUE list (app/dashboard/bookings/verify-payments/
// page.tsx) read booking.totalAmountCents directly instead of calling
// this, and the public checkout form (public-booking-form.tsx) summed
// totalAmountCents + its own local coach-fee variable instead of calling
// this — both silently drifted from the detail screen's number for
// months before anyone noticed. Both now call this function too, but
// nothing in the type system stops a FUTURE fourth consumer from making
// the exact same mistake a third time — if you're computing "what does
// this booking owe" anywhere, call this, don't re-derive it.
// Booking.totalAmountCents is deliberately never rewritten to include
// coaching — it stays a pure court-hire snapshot (see its own schema
// comment); a coach session is a separate, optional add-on created
// after the hold exists, with its own rateCents snapshot. A CANCELLED
// coach session no longer owes anything, so it's excluded; every other
// status (PENDING/CONFIRMED/PAID/CHECKED_IN/COMPLETED/NO_SHOW) still
// represents a real, expected charge.
export function getExpectedPaymentTotalCents(booking: BookingWithOptionalCoachSession): number {
  const courtCents = booking.totalAmountCents ?? 0;
  const coachCents =
    booking.coachSession && booking.coachSession.status !== "CANCELLED"
      ? coachingFeeCents(booking.coachSession)
      : 0;
  return courtCents + coachCents;
}

// THE ONLY PLACE THE COACHING FEE IS MULTIPLIED.
//
// rateCents is HOURLY (owner decision, 2026-08-29). Before that decision
// nothing multiplied it at all: the fee was charged flat while the coach
// was scheduled for the booking's full duration, so a 3-hour booking
// bought 3 hours of coaching for one hour's money.
//
// Exported so the public form, the pre-filled "amount sent" field and
// this file's own total all call the SAME function. Four surfaces have
// to agree on this number — the form, that field,
// getExpectedPaymentTotalCents, and approveBookingPaymentProof's check
// against it — and the way they drift is each one doing its own
// rate * hours. There is one multiplication in this codebase and it is
// here.
export function coachingFeeCents(coachSession: { rateCents: number; hours: number }): number {
  return coachSession.rateCents * coachSession.hours;
}
