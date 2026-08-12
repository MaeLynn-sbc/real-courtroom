"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAnnouncementRepeater } from "@/features/display/lib/announcement-repeater";
import type { TournamentDisplayData, TournamentDisplayMatch } from "@/services/display/tournament-display.service";

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

export function formatMatchAnnouncement(match: TournamentDisplayMatch): string {
  const team1 = joinNamesForSpeech(match.team1.names.map(firstNameOnly));
  const team2 = joinNamesForSpeech(match.team2.names.map(firstNameOnly));
  if (!team1 || !team2) return "";
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
      initialData.matches
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

        for (const match of json.matches) {
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
        <h1 className="font-display text-[clamp(28px,4vw,44px)] leading-none font-extrabold uppercase">
          Tournament — Now Playing
        </h1>
        <div className={reconnecting ? "text-warning text-sm" : "text-slate text-sm"}>
          {reconnecting ? "Reconnecting…" : "Live"}
        </div>
      </div>

      {data.matches.length === 0 ? (
        <p className="text-slate text-lg">No matches currently assigned to a court.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {data.matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
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

function MatchCard({ match }: { match: TournamentDisplayMatch }) {
  return (
    <div className="border-line bg-navy-800 flex flex-col gap-3 rounded-2xl border p-6">
      <div className="flex items-center justify-between">
        <span className="font-jetbrains text-green text-sm font-bold tracking-widest uppercase">
          {match.courtName}
        </span>
        <span
          className={
            match.status === "IN_PROGRESS"
              ? "bg-green/15 text-green rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
              : "bg-court-blue/15 text-court-blue rounded-full px-2 py-0.5 text-xs font-semibold uppercase"
          }
        >
          {match.status === "IN_PROGRESS" ? "In progress" : "Up next"}
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
