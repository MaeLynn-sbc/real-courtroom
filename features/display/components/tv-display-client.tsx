"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createAnnouncementRepeater } from "@/features/display/lib/announcement-repeater";
import type { DisplayCourt, DisplayData } from "@/services/display/display.service";

import styles from "@/app/display/[slug]/tv-display.module.css";

// BUILD-SPEC.md §12/§13. Structure and sizing are ported verbatim from
// docs/tv-display.html (see tv-display.module.css's header comment) —
// this file is the "swap the demo DATA object for a live fetch loop"
// half of that port, plus the operational requirements §13 adds on top
// of the reference (start gate, wake lock, resilient reconnect, 6h
// reload). Never render anything here that displayService didn't
// already put in DisplayData — see that file for what's excluded and
// why.

const RETRY_INTERVAL_MS = 5_000;
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;
const RELOAD_CHECK_INTERVAL_MS = 60_000;
const ENDING_SOON_MS = 2 * 60 * 1000;

// Voice announcements (Web Speech API — browser-native, no external
// service, works offline once the page has loaded). This file already
// depends on the Wake Lock API (see acquireWakeLock below), which only
// Chromium browsers implement — the kiosk device is therefore already
// known to run Chromium, and Chromium's speechSynthesis support is
// mature, so there's no separate "does the kiosk support this" check
// to do beyond the runtime "speechSynthesis" in window guard already
// used below (every call site no-ops cleanly if it's ever missing).
const ANNOUNCEMENTS_MUTED_STORAGE_KEY = "tv-display-announcements-muted";

// Gap between repeated readings of the same announcement (see
// scheduleAnnouncement below). Measured from when the FIRST reading was
// enqueued, not from when it finishes being spoken — utterance length
// varies with the name count (a 4-name group takes noticeably longer to
// read than 1), and timing from enqueue keeps this simple without
// needing a second onend hook just for repeats. 6s comfortably exceeds
// even a 4-name utterance at rate=0.95 (a few seconds), so the repeat
// never overlaps the first reading — the actual silent gap after
// speech ends will vary from roughly 1-5s depending on name count, but
// the second reading is never queued before the first has had a full
// utterance's worth of time.
const ANNOUNCEMENT_REPEAT_GAP_MS = 6_000;

// Manual timer/announce (reported live): auto-announcing the instant a
// foursome was assigned shorted players part of their 15 minutes, since
// the clock and the announcement were bundled into one automatic event.
// The TV now watches announcementRequestedAt itself — a timestamp the
// ANNOUNCE staff action stamps — not a state transition, so it's
// decoupled from starting the timer and safely re-firable (a fresh
// timestamp each press). Works for "op-pending" (before Start Timer, the
// normal case) and "op" (a legitimate re-announce — a no-show — after
// the clock's already running). Returns null for every other state, or
// for one never yet announced, so a court leaving either state — or one
// nobody has pressed ANNOUNCE for — naturally stays out of the tracked
// map below.
function courtAnnouncementToken(court: DisplayCourt): string | null {
  if (court.state !== "op" && court.state !== "op-pending") return null;
  return court.announcementRequestedAt;
}

// Natural spoken list, in the order names appear on the assignment —
// "Ana", "Ana and Ben", "Ana, Ben, and Carla". No abbreviation to "and
// partner(s)": four-name groups were tested live and read acceptably,
// so there's no pacing reason to shorten them.
export function joinNamesForSpeech(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

// "Attention: Ana, Ben, Carla, and Dana, please proceed to Court 2." —
// court name spoken last, exactly as stored (Court.name is already
// "Court 1"/"Court 2"/"Court 3", never an internal id), so the sentence
// itself reads it as a plain number, not a code.
export function formatAssignmentAnnouncement(court: DisplayCourt): string {
  const names = court.players.map((player) => player.name);
  if (names.length === 0) return "";
  return `Attention: ${joinNamesForSpeech(names)}, please proceed to ${court.name}.`;
}

const clockFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dateFormatter = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

function hhmm(iso: string): string {
  return timeFormatter.format(new Date(iso));
}

function cls(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

interface CourtTiming {
  minutes: string;
  seconds: string;
  percentDone: number;
  ending: boolean;
}

function computeTiming(startAt: string, endAt: string, now: number): CourtTiming {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const left = Math.max(0, end - now);
  const total = Math.max(1, end - start);
  return {
    minutes: String(Math.floor(left / 60_000)).padStart(2, "0"),
    seconds: String(Math.floor(left / 1000) % 60).padStart(2, "0"),
    percentDone: Math.max(0, Math.min(100, ((now - start) / total) * 100)),
    ending: left <= ENDING_SOON_MS,
  };
}

// A court booking has just reached its end time — the whole-card flash
// (styles.timeUp), a distinct and more urgent visual than the "ending
// soon" countdown-text blink above (that window's own `left` is
// clamped to 0 by computeTiming, so it stays true once time is
// actually up too — this is an additional overlay, not a replacement).
// Scoped to state === "res" by the caller: a court reservation has a
// hard end time in a way open play's rotating games don't.
export function isTimeUpFlashing(endAt: string, now: number, flashDurationMs: number): boolean {
  const overtimeMs = now - new Date(endAt).getTime();
  return overtimeMs >= 0 && overtimeMs <= flashDurationMs;
}

// One-minute (owner-configurable) warning for a running open-play game
// — reported live, requested as automatic (unlike the assignment
// announcement, this is purely clock-driven: relative to a timer staff
// already started, no human judgment involved). Same lazy-on-read shape
// as isTimeUpFlashing: true only while genuinely inside the warning
// window (left > 0 — time hasn't actually run out yet, isTimeUpFlashing
// picks up from there) and warningMs or less remains.
export function isGameWarningActive(endAt: string, now: number, warningMs: number): boolean {
  const left = new Date(endAt).getTime() - now;
  return left > 0 && left <= warningMs;
}

// "Court 2, one minute remaining." / "Court 2, 2 minutes remaining." —
// same court-name-as-stored convention as formatAssignmentAnnouncement
// above, minutes spoken as a word only for the 1-minute case (the
// example the ask itself gave), a plain number otherwise.
export function formatGameWarningAnnouncement(court: { name: string }, warningMinutes: number): string {
  const time = warningMinutes === 1 ? "one minute" : `${warningMinutes} minutes`;
  return `${court.name}, ${time} remaining.`;
}

export function TvDisplayClient({
  initialData,
  announcementRepeatCount,
  timeUpFlashDurationSeconds,
  announcementVoice,
  refreshIntervalSeconds,
  gameWarningEnabled,
  gameWarningMinutes,
}: {
  initialData: DisplayData;
  announcementRepeatCount: number;
  timeUpFlashDurationSeconds: number;
  // Reported live: the announcement voice changed from female to male on
  // its own — nothing here ever specified one, so it rode whatever the
  // browser/OS picked as default, which can change silently after an
  // update. name+lang identifies a SpeechSynthesisVoice the same way the
  // Web Speech API itself does. null means no preference saved — same
  // as the prior, unspecified behavior.
  announcementVoice: { name: string; lang: string } | null;
  // Approved earlier, built now — was a hardcoded 30s constant. New-
  // assignment detection (courtAssignmentSignature below) diffs against
  // the previous poll's signature before any announcement fires, so a
  // faster interval can't cause a duplicate/repeat announcement — that
  // guarantee doesn't depend on the polling cadence at all.
  refreshIntervalSeconds: number;
  // Owner-toggleable — some nights staff don't want the extra voice
  // interruption. Off means the warning effect below no-ops entirely
  // (no speech, no visual class either — see CourtCard's warningSoon).
  gameWarningEnabled: boolean;
  // Owner-editable, default 1 — some venues want 2 minutes' notice.
  gameWarningMinutes: number;
}) {
  const [data, setData] = useState(initialData);
  const [now, setNow] = useState(() => Date.now());
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => Date.now());
  const [reconnecting, setReconnecting] = useState(false);
  const [started, setStarted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const mountedAtRef = useRef(Date.now());

  // Voice announcements. Seeded from initialData (not empty) so the
  // first live poll only announces a genuinely NEW assignment relative
  // to what's already on screen at load — not every game already in
  // progress when the TV was turned on.
  const previousAnnouncementTokensRef = useRef<Record<string, string>>(
    Object.fromEntries(
      initialData.courts
        .map((court) => [court.id, courtAnnouncementToken(court)] as const)
        .filter((entry): entry is [string, string] => entry[1] !== null),
    ),
  );
  const speechQueueRef = useRef<string[]>([]);
  const isSpeakingRef = useRef(false);
  const mutedRef = useRef(false);
  const [announcementsMuted, setAnnouncementsMutedState] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);

  // Read via a ref (not the prop directly) inside the repeater's
  // recursive setTimeout chain so a changed prop can't leave a chain
  // that was already scheduled with a stale total count — not a real
  // concern today (this only ever changes via a full page reload,
  // TvDisplaySetupPanel's admin control lives on a different page
  // entirely) but keeps the invariant explicit rather than assumed.
  const announcementRepeatCountRef = useRef(announcementRepeatCount);
  useEffect(() => {
    announcementRepeatCountRef.current = announcementRepeatCount;
  }, [announcementRepeatCount]);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "speechSynthesis" in window;
    setSpeechSupported(supported);
    const stored = window.localStorage.getItem(ANNOUNCEMENTS_MUTED_STORAGE_KEY);
    const initialMuted = stored === "true";
    mutedRef.current = initialMuted;
    setAnnouncementsMutedState(initialMuted);
  }, []);

  // Resolved once per device, from that device's own
  // speechSynthesis.getVoices() — voices are a property of whatever
  // machine is actually speaking, not the server, so the saved
  // name+lang is a lookup key, not a guarantee. Chrome in particular
  // often returns an empty list on the very first call before its
  // voices have finished loading async, hence the voiceschanged
  // listener alongside the immediate check. Graceful fallback if the
  // saved voice isn't installed here: resolvedVoiceRef stays null,
  // utterance.voice is simply never set below, and speech falls back to
  // the browser's own default — the exact same behavior this device had
  // before this setting existed, never silence.
  const resolvedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  useEffect(() => {
    if (!announcementVoice || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    function resolveVoice() {
      const match = window.speechSynthesis
        .getVoices()
        .find((candidate) => candidate.name === announcementVoice!.name && candidate.lang === announcementVoice!.lang);
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
    // Queue the next one (if any) whether this one finished cleanly or
    // errored out — a stuck utterance must never silently jam the rest
    // of the queue forever.
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

  // Announcements land one at a time via this queue (speechSynthesis
  // itself has no built-in queueing — calling speak() while already
  // speaking just talks over the current utterance) so two assignments
  // landing in the same poll never overlap.
  const enqueueAnnouncement = useCallback(
    (text: string) => {
      if (!text || mutedRef.current || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      speechQueueRef.current.push(text);
      processSpeechQueue();
    },
    [processSpeechQueue],
  );

  // Pure scheduling logic (features/display/lib/announcement-repeater.ts)
  // — created once, read via refs (enqueueAnnouncement's identity is
  // stable across renders, announcementRepeatCountRef always has the
  // latest count) so this never needs to be recreated when the prop
  // changes. scheduleAnnouncement is this component's one entry point
  // for a genuinely new court assignment (called from the poll loop
  // below): plays it once immediately, then queues the configured
  // number of repeats, cancelling any still-pending repeat chain from a
  // PREVIOUS announcement first — a fresh assignment always wins over
  // finishing a stale repeat, rather than the two interleaving or
  // repeats piling up.
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
    (court: DisplayCourt) => {
      const text = formatAssignmentAnnouncement(court);
      if (!text) return;
      announcementRepeater.schedule(text);
    },
    [announcementRepeater],
  );

  // One-minute (owner-configurable) game warning — fires once per game.
  // Keyed by court.startAt (stable and unique per game instance, same
  // role announcementRequestedAt's token plays for the assignment
  // announcement above), not by court.id alone — a new game on the same
  // court naturally gets a different startAt, which re-arms the guard
  // for it automatically, no explicit reset needed.
  const warnedGameStartAtRef = useRef<Record<string, string>>({});

  function toggleAnnouncementsMuted() {
    const next = !mutedRef.current;
    mutedRef.current = next;
    setAnnouncementsMutedState(next);
    window.localStorage.setItem(ANNOUNCEMENTS_MUTED_STORAGE_KEY, String(next));
    if (next && typeof window !== "undefined" && "speechSynthesis" in window) {
      // Muting is immediate — stop mid-sentence and drop anything
      // queued, rather than finishing the current announcement first.
      window.speechSynthesis.cancel();
      speechQueueRef.current = [];
      isSpeakingRef.current = false;
      // Also drop any pending repeat — without this, muting mid-gap
      // wouldn't actually prevent the repeat, just delay it until right
      // after unmuting, which isn't what "mute" should mean. (Belt and
      // suspenders: enqueueAnnouncement already no-ops while muted, so
      // a missed clear here couldn't have caused an audible bug — but
      // it would leave a dangling timer doing nothing until it fires.)
      announcementRepeater.cancelPending();
    }
  }

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Checked on every 1s clock tick (below), not just each ~10s poll —
  // reading dataRef (not `data` in deps) so this doesn't need its own
  // separate re-run whenever a poll lands; the 1s tick alone is enough
  // to catch the warning threshold within a second of it actually being
  // crossed, closer to "one minute remaining" than a 10s poll interval
  // would allow. gameWarningEnabled/gameWarningMinutes are read directly
  // (not via a ref) since this effect already re-runs every second
  // regardless — no stale-closure risk the way the repeat-count ref
  // above guards against inside its own long-lived setTimeout chain.
  useEffect(() => {
    if (!gameWarningEnabled) return;
    const warningMs = gameWarningMinutes * 60_000;
    for (const court of dataRef.current.courts) {
      if (court.state !== "op") continue;
      if (!isGameWarningActive(court.endAt, now, warningMs)) continue;
      if (warnedGameStartAtRef.current[court.id] === court.startAt) continue;
      warnedGameStartAtRef.current[court.id] = court.startAt;
      enqueueAnnouncement(formatGameWarningAnnouncement(court, gameWarningMinutes));
    }
  }, [now, gameWarningEnabled, gameWarningMinutes, enqueueAnnouncement]);

  // Clock + every countdown on screen re-render off this single 1s tick
  // — matches the reference file's own setInterval(tick, 1000).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Resilient polling (BUILD-SPEC.md §13): "Never blank on error — keep
  // last good data, show a small reconnecting indicator." A failed poll
  // retries sooner (5s) than the normal cadence so a brief wifi drop
  // recovers fast without needing a human to touch the TV; `data` itself
  // is only ever replaced by a successful response.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const pollIntervalMs = refreshIntervalSeconds * 1000;

    async function poll() {
      try {
        const response = await fetch("/api/display", { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unexpected status ${response.status}`);
        }
        const json = (await response.json()) as DisplayData;
        if (cancelled) return;

        // Manual announce detection: compare this poll's per-court
        // announcement token against the last one seen. Only a genuine
        // change (staff pressed ANNOUNCE, for the first time or again)
        // speaks — a court sitting unannounced, or unchanged since its
        // last announce, never fires on a routine refresh, whatever the
        // interval.
        for (const court of json.courts) {
          const token = courtAnnouncementToken(court);
          const previousToken = previousAnnouncementTokensRef.current[court.id];
          if (token && token !== previousToken) {
            scheduleAnnouncement(court);
          }
          if (token) {
            previousAnnouncementTokensRef.current[court.id] = token;
          } else {
            delete previousAnnouncementTokensRef.current[court.id];
          }
        }

        setData(json);
        setLastUpdatedAt(Date.now());
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
      // Belt and suspenders for the 6h reload (a hard window.location.
      // reload(), which wipes all timers on its own) and any other way
      // this component could unmount — a pending repeat has no page
      // left to matter to once this effect tears down.
      announcementRepeater.cancelPending();
    };
  }, [scheduleAnnouncement, announcementRepeater, refreshIntervalSeconds]);

  // Long names shrink, never truncate (BUILD-SPEC.md §12) — same pass
  // as the reference file's fitNames(), scoped to this component's own
  // container instead of the whole document.
  const fitNames = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const selector = `.${styles["next-up"]} .${styles.names} .${styles.n}, .${styles.waiting} .${styles.w}`;
    container.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      while (el.scrollWidth > el.clientWidth + 1 && size > base * 0.5) {
        size -= base * 0.04;
        el.style.fontSize = `${size}px`;
      }
    });
  }, []);

  // On-court player names (.pname/.pnameText) — reported live: the box
  // already spans the full card width (it's a flex column child,
  // stretched by default), but a short name like "Abet" stayed at the
  // fixed CSS font-size, leaving a lot of dead space on either side.
  // Growing font-size instead would also grow the box's HEIGHT (fixed
  // vh padding + line-height: 1), which a 4-name court has no spare
  // room for — so this scales the text horizontally only
  // (transform: scaleX, same technique this file already uses
  // statically for .q-label b / .count-n), per name, toward each
  // name's own box width. Capped well short of the box edge and short
  // of an absurd stretch for a very short name.
  const fitPlayerNameWidths = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const WIDTH_FILL_RATIO = 0.94;
    const MAX_SCALE = 2.4;
    container.querySelectorAll<HTMLElement>(`.${styles.pname}`).forEach((box) => {
      const text = box.querySelector<HTMLElement>(`.${styles.pnameText}`);
      if (!text) return;
      text.style.transform = "";
      const naturalWidth = text.scrollWidth;
      const availableWidth =
        box.clientWidth -
        parseFloat(getComputedStyle(box).paddingLeft) -
        parseFloat(getComputedStyle(box).paddingRight);
      if (naturalWidth <= 0 || availableWidth <= 0) return;
      const scale = Math.min(MAX_SCALE, (availableWidth * WIDTH_FILL_RATIO) / naturalWidth);
      if (scale > 1.02) {
        text.style.transform = `scaleX(${scale})`;
      }
    });
  }, []);

  useEffect(() => {
    function fitAll() {
      fitNames();
      fitPlayerNameWidths();
    }
    fitAll();
    window.addEventListener("resize", fitAll);
    return () => window.removeEventListener("resize", fitAll);
  }, [data, fitNames, fitPlayerNameWidths]);

  const acquireWakeLock = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      // Not fatal — the TV just risks sleeping until the next
      // visibilitychange re-attempt. Nothing to surface on an
      // unattended, login-free screen.
    }
  }, []);

  // The wake lock drops when the screen turns off and does not return
  // on its own (BUILD-SPEC.md §13) — re-acquire on visibilitychange.
  useEffect(() => {
    function onVisibilityChange() {
      if (started && document.visibilityState === "visible") {
        void acquireWakeLock();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [started, acquireWakeLock]);

  // Auto-reload every 6h to pick up deploys, but only when no game is
  // within 60s of ending (BUILD-SPEC.md §13) — never interrupt a
  // countdown a room full of people is watching.
  useEffect(() => {
    const id = setInterval(() => {
      if (Date.now() - mountedAtRef.current < RELOAD_AFTER_MS) return;
      const endingSoon = dataRef.current.courts.some((court) => {
        if (!court.endAt) return false;
        const msLeft = new Date(court.endAt).getTime() - Date.now();
        return msLeft > 0 && msLeft <= 60_000;
      });
      if (!endingSoon) {
        window.location.reload();
      }
    }, RELOAD_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  async function handleStart() {
    setStarted(true);
    try {
      await containerRef.current?.requestFullscreen?.();
    } catch {
      // Some browsers/OSes deny fullscreen outright — the page still
      // works windowed, just without the kiosk chrome-hiding benefit.
    }
    await acquireWakeLock();
  }

  const staleSeconds = Math.round((now - lastUpdatedAt) / 1000);
  const liveLabel = reconnecting ? "Reconnecting…" : staleSeconds < 5 ? "Just updated" : `Updated ${staleSeconds}s ago`;

  const queueUp = data.queue.slice(0, 4);
  const queueThen = data.queue.slice(4, 8);
  const queueRest = data.queue.slice(8);
  const queueShown = queueRest.slice(0, 8);
  const queueExtra = queueRest.length - queueShown.length;

  return (
    <div className={styles.page} ref={containerRef}>
      {!started && (
        <div className={styles.startGate}>
          <button type="button" className={styles.startButton} onClick={handleStart}>
            Start display
          </button>
        </div>
      )}

      <div className={styles.top}>
        <div className={styles.brand}>
          <div className={styles.logo} role="img" aria-label="The Courtroom" />
          <div className={styles.title}>
            Court <span>Status</span>
          </div>
        </div>
        <div className={styles.sub}>
          Live · Updates every {refreshIntervalSeconds} second{refreshIntervalSeconds === 1 ? "" : "s"}
        </div>
        <div className={styles.clock}>
          <b>{clockFormatter.format(now)}</b>
          <span>{dateFormatter.format(now)}</span>
        </div>
      </div>

      <div className={styles.courts}>
        {data.courts.map((court) => (
          <CourtCard
            key={court.id}
            court={court}
            now={now}
            timeUpFlashDurationMs={timeUpFlashDurationSeconds * 1000}
            gameWarningMs={gameWarningEnabled ? gameWarningMinutes * 60_000 : null}
          />
        ))}
      </div>

      <div className={styles.queue}>
        <div className={styles["q-row"]}>
          <div className={styles["q-label"]}>
            <b>
              Open
              <br />
              play
            </b>
            <em className={styles["count-n"]}>{data.queue.length}</em>
            <span>Waiting</span>
          </div>
          <div className={styles["next-up"]}>
            <span className={styles.tag}>Next up</span>
            <span className={styles.names}>
              {queueUp.length ? (
                queueUp.map((name, i) => (
                  <span key={`${name}-${i}`} className={cls(styles.n, styles[`c${i % 4}`])}>
                    {name}
                  </span>
                ))
              ) : (
                <span className={cls(styles.n, styles.c0)}>Nobody waiting</span>
              )}
            </span>
          </div>
          <div className={cls(styles["next-up"], styles.later)}>
            <span className={styles.tag}>After that</span>
            <span className={styles.names}>
              {queueThen.length ? (
                queueThen.map((name, i) => (
                  <span key={`${name}-${i}`} className={styles.n}>
                    {name}
                  </span>
                ))
              ) : (
                <span className={styles.n}>—</span>
              )}
            </span>
          </div>
        </div>
        <div className={cls(styles["q-row"], styles.rest)}>
          <div className={styles.waiting}>
            {queueShown.map((name, i) => (
              <span key={`${name}-${i}`} className={styles.w}>
                <i>{i + 9}</i>
                {name}
              </span>
            ))}
            {queueExtra > 0 && <span className={cls(styles.w, styles.more)}>+{queueExtra} more</span>}
          </div>
        </div>
      </div>

      <div className={cls(styles.live, reconnecting && styles.stale)}>
        <i />
        <span>{liveLabel}</span>
      </div>

      {/* Separate from the TV's own hardware volume — this only mutes
          the spoken court-assignment announcements, not the display
          itself. Hidden entirely when the browser has no speechSynthesis
          to control. */}
      {speechSupported ? (
        <button
          type="button"
          onClick={toggleAnnouncementsMuted}
          className={cls(styles.announceToggle, !announcementsMuted && styles.on)}
          aria-pressed={!announcementsMuted}
        >
          {announcementsMuted ? "Announcements off" : "Announcements on"}
        </button>
      ) : null}
    </div>
  );
}

function CourtCard({
  court,
  now,
  timeUpFlashDurationMs,
  gameWarningMs,
}: {
  court: DisplayCourt;
  now: number;
  timeUpFlashDurationMs: number;
  // null means the owner has the warning switched off entirely — no
  // visual cue either, matching the voice being off too.
  gameWarningMs: number | null;
}) {
  if (court.state === "free") {
    return (
      <div className={cls(styles.court, styles.free)}>
        <div className={styles["court-head"]}>
          <span className={styles["court-no"]}>{court.name}</span>
        </div>
        <div className={styles["big-open"]}>Available</div>
        <div className={styles.sched}>
          <span>Next booking</span>
          <span>{court.next ? `${court.next.name} · ${hhmm(court.next.startAt)}` : "No bookings today"}</span>
        </div>
      </div>
    );
  }

  // Manual timer/announce: a foursome assigned but Start Timer not yet
  // pressed — no startAt/endAt to compute a countdown from, only
  // proposedAt/nudgeAt. Handled before the timing-based branches below,
  // which all assume a real countdown exists.
  if (court.state === "op-pending") {
    const nudging = now >= new Date(court.nudgeAt).getTime();
    return (
      <div className={cls(styles.court, styles.opPending, nudging && styles.opPendingNudge)}>
        <div className={styles["court-head"]}>
          <span className={styles["court-no"]}>{court.name}</span>
          <span className={styles.pill}>Assigned</span>
        </div>
        <div className={styles.players}>
          {court.players.map((player, i) => (
            <span key={`${player.name}-${i}`} className={cls(styles.pname, styles[`c${i % 4}`])}>
              <span className={styles.pnameText}>{player.name}</span>
            </span>
          ))}
        </div>
        <div className={styles.pendingNote}>{nudging ? "Waiting to start" : "Not started yet"}</div>
      </div>
    );
  }

  // Narrowed by the state check above — DisplayCourtActive always
  // carries real startAt/endAt strings.
  const timing = computeTiming(court.startAt, court.endAt, now);

  if (court.state === "res") {
    const timeUp = isTimeUpFlashing(court.endAt, now, timeUpFlashDurationMs);
    return (
      <div
        className={cls(styles.court, styles.res, timing.ending && styles.ending, timeUp && styles.timeUp)}
      >
        <div className={styles["court-head"]}>
          <span className={styles["court-no"]}>{court.name}</span>
        </div>
        <div className={styles.booked}>
          <div className={styles["big-booked"]}>Booked</div>
          <div className={styles["booked-name"]}>{court.players[0]?.name ?? "Guest"}</div>
          <div className={styles["booked-time"]}>
            {hhmm(court.startAt)} — {hhmm(court.endAt)}
          </div>
        </div>
        <div className={styles.timer}>
          <div className={styles.count}>
            {timing.minutes}:{timing.seconds}
            <small>Minutes left</small>
          </div>
          <div className={styles.bar}>
            <i style={{ width: `${timing.percentDone}%` }} />
          </div>
          {court.next && (
            <div className={styles["next-line"]}>
              <span>Next</span>
              <span>
                <b>{court.next.name}</b> · {hhmm(court.next.startAt)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // "op" — open play. Reported live: the same "time's up" red flash the
  // "res" branch above gets never fired for an open-play game hitting
  // its targetGameMinutes limit — isTimeUpFlashing was only ever wired
  // up on the booking branch, even though it's a generic function
  // (endAt/now/flashDurationMs, nothing booking-specific) and
  // display.service.ts already computes court.endAt for "op" the exact
  // same way (start + targetGameMinutes), so the data was always there
  // — this was a wiring gap, not a data gap. Same function, same class,
  // same duration setting as the booking flash — no reason for a
  // rotation running long to look any less urgent than an hourly
  // booking running long.
  const timeUp = isTimeUpFlashing(court.endAt, now, timeUpFlashDurationMs);
  // Distinct from .ending (a generic, fixed 2-minute countdown blink
  // shared with booked courts) and from .timeUp (the post-end-time
  // flash) — this is specifically the owner-configurable "final minute"
  // cue for a running open-play game, mutually exclusive with .timeUp
  // by construction (isGameWarningActive requires real time still left).
  const warningSoon = gameWarningMs != null && isGameWarningActive(court.endAt, now, gameWarningMs);
  return (
    <div
      className={cls(
        styles.court,
        styles.op,
        timing.ending && styles.ending,
        timeUp && styles.timeUp,
        warningSoon && styles.warningSoon,
      )}
    >
      <div className={styles["court-head"]}>
        <span className={styles["court-no"]}>{court.name}</span>
        <span className={styles.pill}>Open play</span>
      </div>
      <div className={styles.players}>
        {court.players.map((player, i) => (
          <span key={`${player.name}-${i}`} className={cls(styles.pname, styles[`c${i % 4}`])}>
            <span className={styles.pnameText}>{player.name}</span>
          </span>
        ))}
      </div>
      <div className={styles.timer}>
        <div className={styles.count}>
          {timing.minutes}:{timing.seconds}
          <small>Minutes left</small>
        </div>
        <div className={styles.bar}>
          <i style={{ width: `${timing.percentDone}%` }} />
        </div>
        <div className={styles.sched}>
          <span>
            {hhmm(court.startAt)} — {hhmm(court.endAt)}
          </span>
          <span>Open play game</span>
        </div>
      </div>
    </div>
  );
}
