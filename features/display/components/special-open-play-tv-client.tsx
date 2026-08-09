"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAnnouncementRepeater } from "@/features/display/lib/announcement-repeater";
import type { SpecialDisplayCourt, SpecialDisplayData } from "@/services/display/special-display.service";

// Owner request (2026-08-09): Special Open Play's own, isolated TV
// display — "a button to call out their names, and different url for
// their display." The Announce BUTTON lives on the admin board
// (features/open-play-special/components/special-open-play-board.tsx);
// this is the read-only watcher — polls, diffs announcementRequestedAt
// per court, speaks when staff press Announce there. Deliberately its
// own, much smaller fork of tv-display-client.tsx's poll/speech-queue
// architecture: no bookings, no game timers, no wake lock/fullscreen
// complexity — Special Open Play has no fixed game duration to count
// down. Currently mounted at /tourtv (temporarily reused — see
// app/tourtv/page.tsx's own comment); zero shared code with
// tournament-tv-display-client.tsx or tv-display-client.tsx.

const RETRY_INTERVAL_MS = 5_000;
const ANNOUNCEMENT_REPEAT_GAP_MS = 6_000;
// Must match the admin board's own GAME_TARGET_MINUTES
// (features/open-play-special/components/special-open-play-board.tsx) —
// duplicated rather than shared, same pattern as COURT_LABELS elsewhere
// in this feature (see special-open-play.service.ts / special-display
// .service.ts / the board component, each with their own copy).
const GAME_TARGET_MINUTES = 20;
const ONE_MINUTE_WARNING_MINUTES = GAME_TARGET_MINUTES - 1;
// Owner request (2026-08-09): "dont auto start the time. create a
// button for it but after 3 minutes when the button is not clicked.
// make it on auto start." Must match the admin board's own copy of
// this constant.
const TIMER_AUTO_START_GRACE_MINUTES = 3;

function courtAnnouncementToken(court: SpecialDisplayCourt): string | null {
  return court.announcementRequestedAt;
}

function courtTimesUpToken(court: SpecialDisplayCourt): string | null {
  return court.timesUpRequestedAt;
}

function joinNamesForSpeech(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function firstNameOnly(name: string): string {
  return name.split(" ")[0] ?? name;
}

export function formatSpecialAnnouncement(court: SpecialDisplayCourt): string {
  const names = court.playerNames.map(firstNameOnly);
  if (names.length === 0) return "";
  return `Attention: ${joinNamesForSpeech(names)}, please proceed to ${court.courtLabel}.`;
}

export function formatSpecialTimesUpAnnouncement(court: SpecialDisplayCourt): string {
  if (court.playerNames.length === 0) return "";
  return `${court.courtLabel}, your time is up!`;
}

export function formatSpecialOneMinuteWarning(court: SpecialDisplayCourt): string {
  if (court.playerNames.length === 0) return "";
  return `${court.courtLabel}, 1 minute remaining.`;
}

// Automatic — "its gonna be automatic" — fires once per game the moment
// elapsed time crosses the (target - 1)-minute mark, purely from the
// timer's effective start (see getEffectiveTimerStart below), no staff
// button. The upper bound keeps it from firing late (e.g. after a slow
// poll) once the game's already fully over, when "1 minute remaining"
// would read as wrong rather than just late.
export function isOneMinuteWarningDue(timerStartIso: string, now: number): boolean {
  const startedAtMs = new Date(timerStartIso).getTime();
  const warnAtMs = startedAtMs + ONE_MINUTE_WARNING_MINUTES * 60_000;
  const endAtMs = startedAtMs + GAME_TARGET_MINUTES * 60_000;
  return now >= warnAtMs && now < endAtMs;
}

// Owner request (2026-08-09): "dont auto start the time. create a
// button for it but after 3 minutes when the button is not clicked.
// make it on auto start" — resolves the timer's real start moment:
// timerStartedAt if staff pressed Start, else startedAt+3min once that
// grace period has elapsed with no button press, else null (still
// within the grace window — timer hasn't effectively started yet).
export function getEffectiveTimerStart(
  startedAt: string | null,
  timerStartedAt: string | null,
  now: number,
): string | null {
  if (timerStartedAt) return timerStartedAt;
  if (!startedAt) return null;
  const autoStartAtMs = new Date(startedAt).getTime() + TIMER_AUTO_START_GRACE_MINUTES * 60_000;
  return now >= autoStartAtMs ? new Date(autoStartAtMs).toISOString() : null;
}

export function SpecialOpenPlayTvClient({
  initialData,
  announcementRepeatCount,
  announcementVoice,
  refreshIntervalSeconds,
}: {
  initialData: SpecialDisplayData;
  announcementRepeatCount: number;
  announcementVoice: { name: string; lang: string } | null;
  refreshIntervalSeconds: number;
}) {
  const [data, setData] = useState(initialData);
  const [reconnecting, setReconnecting] = useState(false);
  const [started, setStarted] = useState(false);

  const previousAnnouncementTokensRef = useRef<Record<string, string>>(
    Object.fromEntries(
      initialData.courts
        .map((court) => [court.courtLabel, courtAnnouncementToken(court)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  );
  const previousTimesUpTokensRef = useRef<Record<string, string>>(
    Object.fromEntries(
      initialData.courts
        .map((court) => [court.courtLabel, courtTimesUpToken(court)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  );
  // Tracks which startedAt already got its 1-minute warning per court, so
  // it fires exactly once per game — keyed by startedAt (not a boolean)
  // so a fresh group on the same court after Complete game naturally
  // gets its own warning again.
  const oneMinuteWarnedStartedAtRef = useRef<Record<string, string>>({});
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);
  const resolvedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const announcementRepeatCountRef = useRef(announcementRepeatCount);

  useEffect(() => {
    announcementRepeatCountRef.current = announcementRepeatCount;
  }, [announcementRepeatCount]);

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
      if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
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
    (court: SpecialDisplayCourt) => {
      const text = formatSpecialAnnouncement(court);
      if (!text) return;
      announcementRepeater.schedule(text);
    },
    [announcementRepeater],
  );

  const scheduleTimesUp = useCallback(
    (court: SpecialDisplayCourt) => {
      const text = formatSpecialTimesUpAnnouncement(court);
      if (!text) return;
      announcementRepeater.schedule(text);
    },
    [announcementRepeater],
  );

  const scheduleOneMinuteWarning = useCallback(
    (court: SpecialDisplayCourt) => {
      const text = formatSpecialOneMinuteWarning(court);
      if (!text) return;
      announcementRepeater.schedule(text);
    },
    [announcementRepeater],
  );

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const pollIntervalMs = refreshIntervalSeconds * 1000;

    async function poll() {
      try {
        const response = await fetch("/api/special-display", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const json = (await response.json()) as SpecialDisplayData;
        if (cancelled) return;

        for (const court of json.courts) {
          const token = courtAnnouncementToken(court);
          const previousToken = previousAnnouncementTokensRef.current[court.courtLabel];
          if (token && token !== previousToken) {
            scheduleAnnouncement(court);
          }
          if (token) {
            previousAnnouncementTokensRef.current[court.courtLabel] = token;
          } else {
            delete previousAnnouncementTokensRef.current[court.courtLabel];
          }

          const timesUpToken = courtTimesUpToken(court);
          const previousTimesUpToken = previousTimesUpTokensRef.current[court.courtLabel];
          if (timesUpToken && timesUpToken !== previousTimesUpToken) {
            scheduleTimesUp(court);
          }
          if (timesUpToken) {
            previousTimesUpTokensRef.current[court.courtLabel] = timesUpToken;
          } else {
            delete previousTimesUpTokensRef.current[court.courtLabel];
          }

          const effectiveTimerStart = getEffectiveTimerStart(court.startedAt, court.timerStartedAt, Date.now());
          if (effectiveTimerStart) {
            const alreadyWarned =
              oneMinuteWarnedStartedAtRef.current[court.courtLabel] === effectiveTimerStart;
            if (!alreadyWarned && isOneMinuteWarningDue(effectiveTimerStart, Date.now())) {
              scheduleOneMinuteWarning(court);
              oneMinuteWarnedStartedAtRef.current[court.courtLabel] = effectiveTimerStart;
            }
          } else {
            delete oneMinuteWarnedStartedAtRef.current[court.courtLabel];
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
  }, [
    scheduleAnnouncement,
    scheduleTimesUp,
    scheduleOneMinuteWarning,
    announcementRepeater,
    refreshIntervalSeconds,
  ]);

  function handleStart() {
    setStarted(true);
  }

  return (
    <div className="bg-navy-900 text-bone relative flex min-h-screen flex-col gap-6 p-8">
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
          Special Open Play
        </h1>
        <div className={reconnecting ? "text-warning text-sm" : "text-slate text-sm"}>
          {reconnecting ? "Reconnecting…" : "Live"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {data.courts.map((court) => (
          <div key={court.courtLabel} className="border-line bg-navy-800 flex flex-col gap-2 rounded-2xl border p-6">
            <span className="font-jetbrains text-green text-sm font-bold tracking-widest uppercase">
              {court.courtLabel}
            </span>
            {court.playerNames.length > 0 ? (
              <ul className="flex flex-col gap-1 text-xl font-bold">
                {court.playerNames.map((name, i) => (
                  <li key={`${name}-${i}`}>{name}</li>
                ))}
              </ul>
            ) : (
              <span className="text-slate text-lg">Empty</span>
            )}
          </div>
        ))}
      </div>

      <div className="border-line bg-navy-800 rounded-2xl border p-6">
        <span className="font-jetbrains text-slate text-sm font-bold tracking-widest uppercase">
          Waiting ({data.waitingNames.length})
        </span>
        <p className="mt-2 text-lg">{data.waitingNames.join(", ") || "—"}</p>
      </div>
    </div>
  );
}
