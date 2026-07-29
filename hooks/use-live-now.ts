"use client";

import { useEffect, useState } from "react";

// Neither booking form re-renders on its own as wall-clock time passes —
// no interval, no polling, nothing. A component that only recomputes
// "is this hour in the past" from an inline Date.now() call goes stale
// the moment nothing else triggers a render, which is exactly what
// happens on a front-desk tab left open all shift: load the page at
// 7:55 AM, come back at 11:00 AM without an intervening interaction,
// and 8:00 AM is still sitting in the option list. Polling on a
// interval, not on visibility/focus events, since the failure mode is
// "nothing happened for hours," not "the tab was backgrounded" — a
// plain interval covers both without extra listeners. 60s is far
// tighter than needed for hour-granularity slots.
const DEFAULT_INTERVAL_MS = 60_000;

export function useLiveNow(intervalMs: number = DEFAULT_INTERVAL_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}
