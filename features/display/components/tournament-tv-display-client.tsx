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
  return [...data.courts.flatMap((court) => court.matches), ...data.unscheduled, ...data.staged];
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

// Same formatters as tv-display-client.tsx's own clock (owner request,
// 2026-08-15: "i want it to be the same as /tv").
const clockFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "short",
  day: "numeric",
});

// Owner request (2026-08-15): "can the voice announcement read the
// complete names as well?" — reads match.team1/team2.names as-is now
// (already full names since tournament-display.service.ts's own
// shortDisplayName stopped abbreviating, see that file's comment),
// no longer trimmed down to bare first names for speech.
export function formatMatchAnnouncement(match: TournamentDisplayMatch): string {
  const team1 = joinNamesForSpeech(match.team1.names);
  const team2 = joinNamesForSpeech(match.team2.names);
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
      className="bg-navy-900 text-bone relative flex h-dvh flex-col gap-6 overflow-hidden p-8"
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
            // A fixed-height, wider-than-tall box (not a square) —
            // organizer logos are commonly wide banner wordmarks (a
            // real one confirmed this: ~3:1), and object-contain inside
            // a square would shrink one down to an unreadable sliver.
            // Still centers/contains a genuinely square logo fine too.
            <div className="relative h-20 w-64 shrink-0">
              <Image
                src={data.tournamentLogoUrl}
                alt={data.tournamentName ?? "Tournament logo"}
                fill
                className="object-contain object-left"
                unoptimized
                priority
              />
            </div>
          ) : null}
          <h1 className="font-display text-[clamp(28px,4vw,44px)] leading-none font-extrabold uppercase">
            {data.tournamentName ?? "Tournament — Now Playing"}
          </h1>
        </div>

        {/* Owner request (2026-08-15): "put this above live updates
            every 10 seconds to save space" — clock stacked on top,
            status line underneath, both in one right-aligned column
            instead of three separate header sections. */}
        <div className="text-right">
          <b className="font-display block text-[clamp(24px,3.5vw,36px)] leading-none font-extrabold">
            {clockFormatter.format(now)}
          </b>
          <span className="font-mono text-slate block text-xs tracking-[0.2em] uppercase">
            {dateFormatter.format(now)}
          </span>
          <span
            className={cn(
              "font-display block text-[1.4vh] font-light tracking-[0.14em] uppercase",
              reconnecting ? "text-warning" : "text-slate",
            )}
          >
            {reconnecting
              ? "Reconnecting…"
              : `Live · Updates every ${refreshIntervalSeconds}s`}
          </span>
        </div>
      </div>

      {/* Owner request (2026-08-15): "the list of players that are not
          playing shouldnt be visible in the tv. only those who will
          play or playing needs to be on display" — the unscheduled
          bucket is still fetched (courtsDisplayService still returns
          it, still useful for a future combined match-card reference
          view), just never rendered here. Reversal of the earlier
          "show every match" ask specifically for the AUDIENCE-facing TV
          — a long list of who hasn't been called yet isn't useful to
          someone watching the venue screen, only who's on court or
          queued up next. */}
      {data.courts.length === 0 ? (
        <p className="text-slate text-lg">No matches right now.</p>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-4">
            {data.courts.map((court) => (
              <CourtCard key={court.courtName} courtName={court.courtName} matches={court.matches} />
            ))}
          </div>
          <NextUpRow staged={data.staged} />
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

// The badge for whichever match is first in this court's queue — only
// that slot is ever "In progress"/"Up now"; anything queued behind it
// shows as the smaller "Next up" line inside CourtRow instead of its
// own badge.
function queueBadge(match: TournamentDisplayMatch): { label: string; tone: "now" | "next" } {
  return match.status === "IN_PROGRESS" ? { label: "In progress", tone: "now" } : { label: "Up now", tone: "next" };
}

// Owner request (2026-08-15): "1 team per line" — the main court box
// (size "lg") stacks each team on its own full line instead of
// squeezing both onto one "vs" line, so a complete (non-abbreviated)
// name always has room. NextUpRow's small side boxes (size "sm") stay
// compact and inline — there isn't room to stack there and the owner's
// "fill this space" complaint was about the big court boxes, not those.
function TeamsLine({ match, size }: { match: TournamentDisplayMatch; size: "lg" | "sm" }) {
  if (size === "sm") {
    return (
      <span className="text-sm leading-snug font-semibold">
        {match.team1.number ? <span className="text-green mr-1.5">{match.team1.number}</span> : null}
        {match.team1.names.join(" & ")}
        <span className="text-slate mx-1.5 text-xs uppercase">vs</span>
        {match.team2.number ? <span className="text-green mr-1.5">{match.team2.number}</span> : null}
        {match.team2.names.join(" & ")}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[clamp(24px,3.4vw,44px)] leading-tight font-bold">
        {match.team1.number ? <span className="text-green mr-2">{match.team1.number}</span> : null}
        {match.team1.names.join(" & ")}
      </span>
      <span className="text-slate text-sm font-normal uppercase">vs</span>
      <span className="text-[clamp(24px,3.4vw,44px)] leading-tight font-bold">
        {match.team2.number ? <span className="text-green mr-2">{match.team2.number}</span> : null}
        {match.team2.names.join(" & ")}
      </span>
    </div>
  );
}

// Owner request (2026-08-15): "the 3 boxes should be on horizontal
// display. so that the names will be more visible and the space will
// be used accordingly" — one full-width row per real court, stacked
// (always shown, even with nothing assigned yet — see
// tournament-display.service.ts's own comment on that), court label +
// badge on the left, teams laid out in the center where long doubles
// names have room to breathe, instead of the earlier 3-column
// tall-card grid which squeezed names into a narrow column. `flex-1`
// on the root — not sized to content — so the 3 rows evenly split
// whatever vertical space the parent container has, instead of
// shrink-wrapping and leaving a dead gap above NextUpRow ("fill this
// space", owner report 2026-08-15). No per-card footer here, "these 3
// boxes will be only at the bottom, not after the court [each court]"
// — the shared Next up/After that/Then row lives once, after all 3
// rows (see NextUpRow below), not repeated per row.
function CourtCard({ courtName, matches }: { courtName: string; matches: TournamentDisplayMatch[] }) {
  const [current] = matches;
  const badge = current ? queueBadge(current) : null;

  return (
    <div className="border-green/60 bg-navy-800 flex flex-1 items-center gap-6 rounded-2xl border-2 p-8">
      <div className="flex w-40 shrink-0 flex-col items-start gap-1.5">
        <span className="font-jetbrains text-lg font-extrabold tracking-widest uppercase">{courtName}</span>
        {badge ? (
          <span
            className={
              badge.tone === "now"
                ? "bg-green/15 text-green rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
                : "bg-court-blue/15 text-court-blue rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
            }
          >
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        {current ? (
          <>
            <span className="text-slate text-xs">{current.categoryLabel}</span>
            <TeamsLine match={current} size="lg" />
          </>
        ) : (
          <span className="text-green text-[clamp(32px,5vw,64px)] leading-none font-extrabold uppercase">
            Available
          </span>
        )}
      </div>
    </div>
  );
}

const NEXT_SLOT_LABELS = ["Next up", "After that", "Then"] as const;

// One shared row, after all 3 court cards — not per court (owner
// correction, 2026-08-15). Owner request (2026-08-15): "add also in the
// dropdown the next up after that and then. then we will just manually
// transfer them to court numbers" — these 3 boxes now read directly from
// staff's own manual staging (Match.stagedSlot via the Scoresheet
// dropdown) instead of auto-deriving overflow from each court's queue,
// so what's on screen always matches what staff actually staged. No
// court name shown (a staged match has none yet — that's the point).
function NextUpRow({ staged }: { staged: TournamentDisplayMatch[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {NEXT_SLOT_LABELS.map((label, index) => {
        const match = staged[index] ?? null;
        return (
          <div key={label} className="border-line bg-navy-800/60 flex flex-col gap-1 rounded-xl border p-4">
            <span className="text-slate text-[10px] font-bold tracking-widest uppercase">{label}</span>
            {match ? (
              <TeamsLine match={match} size="sm" />
            ) : (
              <span className="text-slate/50 text-sm">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

