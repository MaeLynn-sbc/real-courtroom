"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getPendingPaymentVerificationCountAction } from "@/actions/dashboard.actions";

// A staff member glances at this from across the room while working the
// desk — the existing small header badge (dashboard-header.tsx) is easy
// to miss at that distance, reported live as actually being missed.
// Polls every 30s so the count updates without a page navigation (same
// pattern as hooks/use-live-now.ts, but polling a real server value
// instead of the client clock — a booking created or paid on a customer's
// phone has no other way to reach a staff member already sitting on a
// dashboard page). Kept alongside the header badge, not replacing it —
// the badge is still useful once this banner scrolls out of view on a
// long page, and removing a working affordance for a new one adds risk
// for no real gain.
const POLL_INTERVAL_MS = 30_000;

export function VerificationBanner({ initialCount }: { initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    const interval = setInterval(() => {
      getPendingPaymentVerificationCountAction()
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
      href="/dashboard/bookings/verify-payments"
      className="bg-primary text-primary-foreground mb-4 flex items-center justify-center rounded-2xl px-6 py-4 text-center text-lg font-semibold transition-opacity hover:opacity-90"
    >
      {count} {count === 1 ? "payment" : "payments"} to verify
    </Link>
  );
}
