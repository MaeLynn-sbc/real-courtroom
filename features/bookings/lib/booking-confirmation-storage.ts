"use client";

// Real incident (2026-08-06): a customer switches to the GCash app to
// send payment, then switches back to the browser — on some phones this
// evicts the tab from memory, so returning to it triggers a full RELOAD
// of /book?courtId=...&date=...&time=..., not just a resume. That reload
// re-runs the server-side deep-link availability check
// (app/book/page.tsx) — which now correctly sees the slot as unavailable,
// because it's the customer's OWN just-created hold blocking it — and
// shows "That slot was just taken" instead of their confirmation screen.
// The booking itself is fine (proven: it shows up on the staff dashboard
// immediately); only the customer's OWN confirmation view was lost.
//
// This is a presentation-layer fix only — the real availability gate
// stays createPublicBooking's own Serializable-transaction check at
// submit time, completely untouched. Storing the confirmation locally
// lets a reload for the SAME exact deep-linked slot restore what the
// customer already saw, instead of either a blank form or a false
// "someone else took it" message.
//
// Scoped to exactly the deep-linked slot (court + date + time + duration)
// — a reload landing on a DIFFERENT slot than the one actually booked
// correctly finds no match here and falls through to the real
// availability check, unchanged.
function storageKey(courtId: string, date: string, time: string, durationMinutes: string): string {
  return `courtroom:booking-confirmation:${courtId}:${date}:${time}:${durationMinutes}`;
}

// Generous but bounded — long enough to cover a slow return trip from
// the GCash app (minutes, not hours, in practice), short enough that a
// genuinely abandoned old tab doesn't resurrect a stale confirmation
// days later.
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function saveBookingConfirmation(
  courtId: string,
  date: string,
  time: string,
  durationMinutes: string,
  data: unknown,
): void {
  try {
    window.localStorage.setItem(
      storageKey(courtId, date, time, durationMinutes),
      JSON.stringify({ savedAt: Date.now(), data }),
    );
  } catch {
    // Private browsing / storage disabled / quota exceeded — this is
    // purely a reload-recovery nicety, never a reason to break booking.
  }
}

// JSON.stringify turns a Date (e.g. BookingConfirmation.holdExpiresAt)
// into a plain ISO string — JSON.parse does NOT reverse that on its own.
// Without this reviver, a restored confirmation's holdExpiresAt would be
// a string, not a Date, and every place that calls
// holdTimeFormatter.format(confirmation.holdExpiresAt) would misbehave.
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === "string" && ISO_DATE_PATTERN.test(value)) {
    return new Date(value);
  }
  return value;
}

export function readBookingConfirmation<T>(
  courtId: string,
  date: string,
  time: string,
  durationMinutes: string,
): T | null {
  try {
    const raw = window.localStorage.getItem(storageKey(courtId, date, time, durationMinutes));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw, reviveDates) as { savedAt: number; data: T };
    if (typeof parsed.savedAt !== "number" || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}
