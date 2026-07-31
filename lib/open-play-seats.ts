// Reported live: the capacity page's header showed "Capacity 40. Status:
// OPEN." with no seat count, and separately the Roster panel computed its
// own, narrower "seated" count (CONFIRMED + waitlistPos null only) that
// silently disagreed with the canonical occupied-seat predicate used
// everywhere money/capacity decisions get made (countOccupiedSeats in
// open-play-registration.service.ts, getUpcomingNights's groupBy in
// open-play-capacity.service.ts). A public number that disagrees with
// another number on the same screen is worse than no number.
//
// This lives in lib/, not the registration service, specifically so it
// has zero server-only dependencies (no prisma import) — both the
// server-rendered capacity page AND the "use client" Roster panel need
// it, and importing a Prisma-touching service module from a client
// component would pull the whole server module into the browser bundle.
//
// Same predicate, three call sites: CONFIRMED/PENDING_VERIFICATION
// always occupy a seat; an AWAITING_PAYMENT hold only while its
// holdExpiresAt hasn't passed; any walk-in-waitlist row (waitlistPos not
// null) never counts, seated or not.
export function isRegistrationOccupyingSeat(
  registration: { status: string; waitlistPos: number | null; holdExpiresAt: Date | null },
  now: Date,
): boolean {
  if (registration.waitlistPos !== null) return false;
  if (registration.status === "CONFIRMED" || registration.status === "PENDING_VERIFICATION")
    return true;
  if (registration.status === "AWAITING_PAYMENT") {
    return registration.holdExpiresAt !== null && registration.holdExpiresAt >= now;
  }
  return false;
}

// "Confirm both read from the same function" — the home page's
// Friday/Saturday cards and the public registration page both need
// "how many seats are left," derived from getUpcomingNights's own
// registeredCount (which already applies isRegistrationOccupyingSeat's
// identical predicate as a DB-side groupBy — see that function's own
// comment). This is the one-line subtraction both pages do to it,
// pulled out so neither can drift from the other by re-typing
// Math.max(0, ...) twice. Never negative — a night can't have fewer
// than zero seats left even if registeredCount momentarily exceeds
// capacity (e.g. an owner lowering capacity below current sign-ups).
export function computeRemainingSeats(capacity: number, registeredCount: number): number {
  return Math.max(0, capacity - registeredCount);
}
