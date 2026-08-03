"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getStaleHoldsCountAction } from "@/actions/dashboard.actions";

// A stale hold now blocks its court indefinitely (2026-08-03 — see
// booking.service.ts's checkAvailabilityWithClient comment for the
// incident that drove this) until a staff member cancels it, so
// "notice eventually" is no longer good enough — this is the same
// glance-from-across-the-room precedent as VerificationBanner, polling
// so a stale hold surfaces without anyone having to go looking for it.
const POLL_INTERVAL_MS = 30_000;

export function StaleHoldsBanner({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const interval = setInterval(() => {
      getStaleHoldsCountAction()
        .then(setCount)
        .catch(() => {
          // Transient poll failure — next tick retries; nothing to show
          // for a single missed poll.
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  if (count === 0) {
    return null;
  }

  return (
    <Link
      href="/dashboard/bookings/stale-holds"
      className="bg-warning text-warning-foreground mb-4 flex items-center justify-center rounded-2xl px-6 py-4 text-center text-lg font-semibold transition-opacity hover:opacity-90"
    >
      {count} {count === 1 ? "court" : "courts"} still held on an unpaid booking — needs a decision
    </Link>
  );
}
