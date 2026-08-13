"use client";

import { AlertTriangle, ArrowRight } from "lucide-react";
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
      // Restyled 2026-08-13 (visual only — same route, same polling, same
      // zero-count behaviour). Was a full-bleed primary-green slab: the
      // single loudest element on the dashboard, in the same green as the
      // primary button and the active nav item, for what is usually a
      // one-item queue. Green also read as "all good" while the header's
      // own pill said the same thing in destructive red — the same fact
      // in two contradictory colours. Now an amber "needs attention" row
      // that still spans the content width (so it's not missed from
      // across the desk, the reason this banner exists) but no longer
      // outweighs everything beneath it.
      className="mb-4 flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 transition-colors hover:bg-amber-500/15"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
        <AlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold">
        {count} {count === 1 ? "payment is" : "payments are"} waiting to be verified
      </span>
      <span className="text-muted-foreground hidden items-center gap-1 text-sm font-semibold sm:flex">
        Verify now
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );
}
