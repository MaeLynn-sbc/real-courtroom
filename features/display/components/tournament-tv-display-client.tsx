"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Logo } from "@/components/shared/logo";
import { createAnnouncementRepeater } from "@/features/display/lib/announcement-repeater";
import { cn } from "@/lib/utils";
import type { TournamentDisplayData, TournamentDisplayMatch } from "@/services/display/tournament-display.service";

// Every match the service returns, across every court's queue plus the
// not-yet-scheduled bucket — used for the announcement token diff and
// for the "any matches at all?" empty state, now that the data isn't
// one flat array anymore (owner request, 2026-08-15: real per-court
// queues, not just a single match per court).
function flattenMatches(data: TournamentDisplayData): TournamentDisplayMatch[] {
  return [...data.courts.flatMap((court) => court.matches), ...data.unscheduled];
}

// Tournament twin of tv-display-client.tsx — same poll-loop/speech-queue/
// token-diff architecture, trimmed to what a tournament actually needs:
// no game timer/countdown (a match has no fixed target duration the way
// an Open Play game or a court booking does), no wake-lock CSS module
// port (fresh Tailwind markup instead, no existing reference design to
// port here). Own localStorage key for muting — a separate kiosk screen,
// muting this one must not silently mute the Open Play TV or vice versa.

const RETRY_INTERVAL_MS = 5_000;
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;
const ANNOUNCEMENT_REPEAT_GAP_MS = 6_000;
const ANNOUNCEMENTS_MUTED_STORAGE_KEY = "tourtv-announcements-muted";

function matchAnnouncementToken(match: TournamentDisplayMatch): string | null {
  return match.announcementRequestedAt;
}

// Same natural-list phrasing as tv-display-client.tsx's joinNamesForSpeech
// — duplicated, not imported, so the two kiosk displays stay independent
// (see this file's own top comment).
function joinNamesForSpeech(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} and ${names[1]}`;
}

// Spoken names are bare first names only (owner decision, 2026-08-09) —
// the on-screen card still shows the full "First L." shortened name;
// only the VOICE reads first names, same reasoning as
// tv-display-client.tsx's own firstNameOnly (an initial can read oddly
// through text-to-speech).
function firstNameOnly(name: string): string {
  return name.split(" ")[0] ?? name;
}

// Same formatters as tv-display-client.tsx's own clock (owner request,
// 2026-08-15: "i want it to be the same as /tv").
const clockFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

export function formatMatchAnnouncement(match: TournamentDisplayMatch): string {
  const team1 = joinNamesForSpeech(match.team1.names.map(firstNameOnly));
  const team2 = joinNamesForSpeech(match.team2.names.map(firstNameOnly));
  // courtName is only ever null for an unscheduled match, which can
  // never have a real announcementRequestedAt token in the first place
  // (scheduleMatch is what stamps it, and that always sets a court at
  // the same time) — this guard is just for the type, not a real case.
  if (!team1 || !team2 || !match.courtName) return "";
  return `Attention: ${team1}, versus ${team2}, please proceed to ${match.courtName}.`;
}

export function TournamentTvDisplayClient({
  initialData,
  announcementRepeatCount,
  announcementVoice,
  refreshIntervalSeconds,
}: {
  initialData: TournamentDisplayData;
  announcementRepeatCount: number;
  announcementVoice: { name: string; lang: string } | null;
  refreshIntervalSeconds: number;
}) {
  const [data, setData] = useState(initialData);
  const [reconnecting, setReconnecting] = useState(false);
  const [started, setStarted] = useState(false);
  const [announcementsMuted, setAnnouncementsMutedState] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  // Live clock in the header — same pattern as tv-display-client.tsx's
  // own `now` state (owner request, 2026-08-15: "i want it to be the
  // same as /tv").
  const [now, setNow] = useState(() => Date.now());

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedAtRef = useRef(Date.now());
  const dataRef = useRef(data);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  // Seeded from initialData, not empty — the first live poll only
  // announces a genuinely NEW court assignment relative to what's
  // already on screen at load, not every match already on a court when
  // the TV was turned on. Same pattern as tv-display-client.tsx.
  const previousTokensRef = useRef<Record<string, string>>(
    Object.fromEntries(
      flattenMatches(initialData)
        .map((match) => [match.id, matchAnnouncementToken(match)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  );
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);
  const mutedRef = useRef(false);
  const resolvedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const announcementRepeatCountRef = useRef(announcementRepeatCount);

  useEffect(() => {
    announcementRepeatCountRef.current = announcementRepeatCount;
  }, [announcementRepeatCount]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window;
    setSpeechSupported(supported);
    const stored = window.localStorage.getItem(ANNOUNCEMENTS_MUTED_STORAGE_KEY);
    const initialMuted = stored === "true";
    mutedRef.current = initialMuted;
    setAnnouncementsMutedState(initialMuted);
  }, []);

  useEffect(() => {
    if (!announcementVoice || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    function resolveVoice() {
      const match = window.speechSynthesis
        .getVoices()
        .find(
          (candidate) =>
            candidate.name === announcementVoice!.name && candidate.lang === announcementVoice!.lang,
        );
      if (match) {
        resolvedVoiceRef.current = match;
      }
    }
    resolveVoice();
    window.speechSynthesis.addEventListener("voiceschanged", resolveVoice);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", resolveVoice);
  }, [announcementVoice]);

  const processSpeechQueue = useCallback(() => {
    if (isSpeakingRef.current) return;
    const next = speechQueueRef.current.shift();
    if (!next) return;
    isSpeakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(next);
    utterance.rate = 0.95;
    if (resolvedVoiceRef.current) {
      utterance.voice = resolvedVoiceRef.current;
    }
    utterance.onend = () => {
      isSpeakingRef.current = false;
      processSpeechQueue();
    };
    utterance.onerror = () => {
      isSpeakingRef.current = false;
      processSpeechQueue();
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const enqueueAnnouncement = useCallback(
    (text: string) => {
      if (!text || mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) {
        return;
      }
      speechQueueRef.current.push(text);
      processSpeechQueue();
    },
    [processSpeechQueue],
  );

  const announcementRepeater = useMemo(
    () =>
      createAnnouncementRepeater({
        speak: (text) => enqueueAnnouncement(text),
        gapMs: ANNOUNCEMENT_REPEAT_GAP_MS,
        getRepeatCount: () => announcementRepeatCountRef.current,
      }),
    [enqueueAnnouncement],
  );

  const scheduleAnnouncement = useCallback(
    (match: TournamentDisplayMatch) => {
      const text = formatMatchAnnouncement(match);
      if (!text) return;
      announcementRepeater.schedule(text);
    },
    [announcementRepeater],
  );

  function toggleAnnouncementsMuted() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setAnnouncementsMutedState(next);
    window.localStorage.setItem(ANNOUNCEMENTS_MUTED_STORAGE_KEY, String(next));
    if (next && typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      announcementRepeater.cancelPending();
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const pollIntervalMs = refreshIntervalSeconds * 1000;

    async function poll() {
      try {
        const response = await fetch("/api/tournament-display", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const json = (await response.json()) as TournamentDisplayData;
        if (cancelled) return;

        for (const match of flattenMatches(json)) {
          const token = matchAnnouncementToken(match);
          const previousToken = previousTokensRef.current[match.id];
          if (token && token !== previousToken) {
            scheduleAnnouncement(match);
          }
          if (token) {
            previousTokensRef.current[match.id] = token;
          } else {
            delete previousTokensRef.current[match.id];
          }
        }

        setData(json);
        setReconnecting(false);
        timeoutId = setTimeout(poll, pollIntervalMs);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        timeoutId = setTimeout(poll, RETRY_INTERVAL_MS);
      }
    }

    timeoutId = setTimeout(poll, pollIntervalMs);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      announcementRepeater.cancelPending();
    };
  }, [scheduleAnnouncement, announcementRepeater, refreshIntervalSeconds]);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Not fatal — same as tv-display-client.tsx's own acquireWakeLock.
    }
  }, []);

  useEffect(() => {
    function onVisibilityChange() {
      if (started && document.visibilityState === "visible") {
        void acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [started, acquireWakeLock]);

  // Auto-reload every 6h to pick up deploys — no "ending soon" guard to
  // check (unlike Open Play's countdown-aware version), a tournament
  // match has no fixed end time to avoid interrupting.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - mountedAtRef.current < RELOAD_AFTER_MS) return;
      window.location.reload();
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  async function handleStart() {
    setStarted(true);
    try {
      await containerRef.current?.requestFullscreen?.();
    } catch {
      // Some browsers/OSes deny fullscreen outright — still works windowed.
    }
    await acquireWakeLock();
  }

  return (
    <div
      ref={containerRef}
      className="bg-navy-900 text-bone relative flex min-h-screen flex-col gap-6 p-8"
    >
      {!started && (
        <div className="bg-navy-900/95 absolute inset-0 z-10 flex items-center justify-center">
          <button
            type="button"
            onClick={handleStart}
            className="bg-green text-navy-900 rounded-full px-8 py-4 text-xl font-bold uppercase tracking-wide"
          >
            Start display
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Owner request (2026-08-15): "use their logo... emphasize the
            logo of the tournament itself" but "we can still put the
            courtroom somewhere" — The Courtroom stays present (small,
            secondary) while the organizer's own uploaded logo (bigger,
            leading) is the one that reads first. Falls back to the
            plain-text heading whenever the feed spans more than one
            tournament (or none) — tournamentLogoUrl/tournamentName are
            only ever set when every match on screen belongs to the same
            one, see tournament-display.service.ts's own comment. */}
        <div className="flex items-center gap-4">
          <Logo size="sm" className="opacity-70" />
          {data.tournamentLogoUrl ? (
            <Image
              src={data.tournamentLogoUrl}
              alt={data.tournamentName ?? "Tournament logo"}
              width={64}
              height={64}
              className="size-16 shrink-0 rounded-lg object-contain"
              unoptimized
              priority
            />
          ) : null}
          <h1 className="font-display text-[clamp(28px,4vw,44px)] leading-none font-extrabold uppercase">
            {data.tournamentName ?? "Tournament — Now Playing"}
          </h1>
        </div>

        {/* Matches /tv's own header exactly (owner request, 2026-08-15:
            "i want it to be the same as /tv") — centered status line,
            big live clock on the right. */}
        <div
          className={cn(
            "font-display hidden text-center text-[1.7vh] font-light tracking-[0.14em] uppercase md:block",
            reconnecting ? "text-warning" : "text-slate",
          )}
        >
          {reconnecting
            ? "Reconnecting…"
            : `Live · Updates every ${refreshIntervalSeconds} second${refreshIntervalSeconds === 1 ? "" : "s"}`}
        </div>

        <div className="text-right">
          <b className="font-display block text-[clamp(24px,3.5vw,36px)] leading-none font-extrabold">
            {clockFormatter.format(now)}
          </b>
          <span className="font-mono text-slate text-xs tracking-[0.2em] uppercase">
            {dateFormatter.format(now)}
          </span>
        </div>
      </div>

      {data.courts.length === 0 && data.unscheduled.length === 0 ? (
        <p className="text-slate text-lg">No matches right now.</p>
      ) : (
        <>
          {data.courts.length > 0 ? (
            <div className="flex flex-col gap-8">
              {data.courts.map((court) => (
                <div key={court.courtName} className="flex flex-col gap-3">
                  <h2 className="font-jetbrains text-green text-lg font-bold tracking-widest uppercase">
                    {court.courtName}
                  </h2>
                  <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
                    {court.matches.map((match, index) => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        courtName={court.courtName}
                        queuePosition={index}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {data.unscheduled.length > 0 ? (
            <UnscheduledSection matches={data.unscheduled} />
          ) : null}
        </>
      )}

      {speechSupported ? (
        <button
          type="button"
          onClick={toggleAnnouncementsMuted}
          aria-pressed={!announcementsMuted}
          className="border-line fixed right-6 bottom-6 rounded-full border px-4 py-2 text-sm"
        >
          {announcementsMuted ? "Announcements off" : "Announcements on"}
        </button>
      ) : null}
    </div>
  );
}

// Badge reflects POSITION IN THIS COURT'S QUEUE, not just the match's
// own status — only the queue's first slot can ever read "In progress"
// or "Up now"; anything queued behind it ("the next teams who would
// play," owner request 2026-08-15) reads "Then #N" regardless of its
// own SCHEDULED status, since that status alone can't distinguish "next
// on this court" from "third in line."
function queueBadge(match: TournamentDisplayMatch, queuePosition: number): { label: string; tone: "now" | "next" | "then" } {
  if (queuePosition === 0) {
    return match.status === "IN_PROGRESS" ? { label: "In progress", tone: "now" } : { label: "Up now", tone: "next" };
  }
  return { label: `Then #${queuePosition + 1}`, tone: "then" };
}

function MatchCard({
  match,
  courtName,
  queuePosition,
}: {
  match: TournamentDisplayMatch;
  courtName: string;
  queuePosition: number;
}) {
  const badge = queueBadge(match, queuePosition);
  return (
    <div className="border-line bg-navy-800 flex flex-col gap-3 rounded-2xl border p-6">
      <div className="flex items-center justify-between">
        <span className="font-jetbrains text-green text-sm font-bold tracking-widest uppercase">
          {courtName}
        </span>
        <span
          className={
            badge.tone === "now"
              ? "bg-green/15 text-green rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
              : badge.tone === "next"
                ? "bg-court-blue/15 text-court-blue rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
                : "bg-slate/15 text-slate rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
          }
        >
          {badge.label}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-2xl font-bold">
        <span>
          {match.team1.number ? <span className="text-green mr-2">{match.team1.number}</span> : null}
          {match.team1.names.join(" & ")}
        </span>
        <span className="text-slate text-sm font-normal uppercase">vs</span>
        <span>
          {match.team2.number ? <span className="text-green mr-2">{match.team2.number}</span> : null}
          {match.team2.names.join(" & ")}
        </span>
      </div>
      <span className="text-slate text-xs">{match.categoryLabel}</span>
    </div>
  );
}

// "i want every match to be shown in /tourtv" (owner request,
// 2026-08-15) — a compact reference list for matches with no court
// assigned yet, grouped by category, deliberately plainer than
// MatchCard's big queue cards above (this is a glance-at-it reference,
// not the flashy now-playing centerpiece a live TV is actually for).
function UnscheduledSection({ matches }: { matches: TournamentDisplayMatch[] }) {
  const byCategory = new Map<string, TournamentDisplayMatch[]>();
  for (const match of matches) {
    const existing = byCategory.get(match.categoryLabel);
    if (existing) {
      existing.push(match);
    } else {
      byCategory.set(match.categoryLabel, [match]);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-slate text-lg font-bold tracking-widest uppercase">Not yet on a court</h2>
      <div className="grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from(byCategory.entries()).map(([categoryLabel, categoryMatches]) => (
          <div key={categoryLabel} className="flex flex-col gap-1.5">
            <span className="text-slate text-xs font-semibold tracking-wide uppercase">{categoryLabel}</span>
            <ul className="flex flex-col gap-1">
              {categoryMatches.map((match) => (
                <li key={match.id} className="text-sm">
                  {match.team1.number ? <span className="text-green mr-1">{match.team1.number}</span> : null}
                  {match.team1.names.join(" & ")}
                  <span className="text-slate mx-1.5 uppercase">vs</span>
                  {match.team2.number ? <span className="text-green mr-1">{match.team2.number}</span> : null}
                  {match.team2.names.join(" & ")}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
