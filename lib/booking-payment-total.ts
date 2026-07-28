import type { CoachSessionStatus } from "@/lib/generated/prisma/enums";

export interface BookingWithOptionalCoachSession {
  totalAmountCents: number | null;
  coachSession: { status: CoachSessionStatus; rateCents: number } | null;
}

// The single source of truth for "what does this booking actually owe,
// including any coach add-on" — used both for the customer-facing total
// (shown before they pay) and expectedAmountCents on the staff
// verification screen, so the two can never disagree.
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
    booking.coachSession && booking.coachSession.status !== "CANCELLED" ? booking.coachSession.rateCents : 0;
  return courtCents + coachCents;
}
