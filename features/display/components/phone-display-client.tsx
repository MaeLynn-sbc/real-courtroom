"use client";

import { useEffect, useRef, useState } from "react";

import type { DisplayCourt, DisplayData } from "@/services/display/display.service";

// Phone counterpart to the TV kiosk (tv-display-client.tsx) — same data
// source (/api/display, here with ?names=first — see that route's own
// comment on why the name format differs), same "never blank on a failed
// poll, just show a small reconnecting indicator" resilience, but
// deliberately without the kiosk-only concerns: no voice (dropped from
// v1 — iOS Safari silently stops speech synthesis on screen lock/
// backgrounding, exactly the scenario this page is for, and a feature
// that quietly fails in its own core use case is worse than not having
// it), no wake lock, no fullscreen start-gate, no auto-reload. A phone
// visit is a single fresh page load someone checks and puts back in
// their pocket, not a permanently-mounted kiosk tab.
const POLL_INTERVAL_MS = 10_000;
const RETRY_INTERVAL_MS = 5_000;

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function hhmm(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

function minutesLeft(endAt: string, now: number): number {
  return Math.max(0, Math.round((new Date(endAt).getTime() - now) / 60_000));
}

function isFullyEmpty(data: DisplayData): boolean {
  return data.courts.every((court) => court.state === "free") && data.queue.length === 0;
}

export function PhoneDisplayClient({ initialData }: { initialData: DisplayData }) {
  const [data, setData] = useState(initialData);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => Date.now());
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Same resilient-polling shape as the TV client: a failed poll retries
  // sooner than the normal cadence, and `data` is only ever replaced by a
  // successful response — a brief connectivity drop never blanks the page.
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch("/api/display?names=first", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const json = (await response.json()) as DisplayData;
        if (cancelled) return;
        setData(json);
        setLastUpdatedAt(Date.now());
        setReconnecting(false);
        timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        timeoutId = setTimeout(poll, RETRY_INTERVAL_MS);
      }
    }

    timeoutId = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, []);

  const staleSeconds = Math.round((now - lastUpdatedAt) / 1000);
  const liveLabel = reconnecting ? "Reconnecting…" : staleSeconds < 5 ? "Just updated" : `Updated ${staleSeconds}s ago`;
  const empty = isFullyEmpty(data);

  return (
    <div className="bg-navy-900 flex min-h-svh flex-col px-4 pt-6 pb-10">
      <header className="mx-auto w-full max-w-md">
        <h1 className="font-display text-bone text-3xl font-extrabold tracking-[-0.01em] uppercase">
          Who&apos;s Playing
        </h1>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`size-1.5 rounded-full ${reconnecting ? "bg-coral" : "bg-green"}`}
          />
          <span className="text-slate text-xs">{liveLabel}</span>
        </div>
      </header>

      {empty ? (
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-2 py-20 text-center">
          <p className="text-bone text-lg font-semibold">Nobody&apos;s playing right now.</p>
          <p className="text-slate text-sm">Check back later, or come find us — every court&apos;s open.</p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 pt-5">
          {data.courts.map((court) => (
            <CourtRow key={court.id} court={court} now={now} />
          ))}

          <section className="border-line bg-navy-800 mt-2 rounded-2xl border p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-bone text-sm font-semibold uppercase tracking-wide">Waiting</h2>
              <span className="font-jetbrains text-green text-xs font-bold">{data.queue.length}</span>
            </div>
            {data.queue.length === 0 ? (
              <p className="text-slate mt-2 text-sm">Nobody in the queue.</p>
            ) : (
              <ol className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
                {data.queue.map((name, index) => (
                  <li key={`${name}-${index}`} className="text-bone flex items-baseline gap-2 py-0.5">
                    <span className="font-jetbrains text-slate w-5 shrink-0 text-xs">{index + 1}</span>
                    <span>{name}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CourtRow({ court, now }: { court: DisplayCourt; now: number }) {
  if (court.state === "free") {
    return (
      <div className="border-line bg-navy-800 flex items-center justify-between gap-3 rounded-2xl border p-4">
        <div>
          <p className="text-bone font-semibold">{court.name}</p>
          <p className="text-slate text-xs">
            {court.next ? `Next: ${court.next.name} · ${hhmm(court.next.startAt)}` : "No bookings today"}
          </p>
        </div>
        <span className="bg-green/15 text-green rounded-full px-3 py-1 text-xs font-bold uppercase">Available</span>
      </div>
    );
  }

  const left = minutesLeft(court.endAt, now);

  return (
    <div className="border-line bg-navy-800 rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-bone font-semibold">{court.name}</p>
        <span className="bg-coral/15 text-coral rounded-full px-3 py-1 text-xs font-bold uppercase">
          {court.state === "op" ? "Open play" : "Booked"}
        </span>
      </div>
      <p className="text-bone mt-2 text-sm">
        {court.players.length > 0 ? court.players.map((player) => player.name).join(", ") : "Guest"}
      </p>
      <div className="text-slate mt-1 flex items-center justify-between text-xs">
        <span>
          {hhmm(court.startAt)} – {hhmm(court.endAt)}
        </span>
        <span className="font-jetbrains font-bold">{left}m left</span>
      </div>
    </div>
  );
}
