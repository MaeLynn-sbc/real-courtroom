"use client";

import { useEffect, useState } from "react";

import { buildLine, type LineSet } from "@/features/display/lib/line-sets";
import type { DisplayCourt, DisplayData } from "@/services/display/display.service";
import { OPEN_PLAY_SKILL_COLOR, skillTextClass } from "@/types/open-play-skill-color";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

const RETRY_INTERVAL_MS = 5_000;
const RELOAD_AFTER_MS = 6 * 60 * 60 * 1000;
// How many waiting sets fit on screen: two rows of five. Anything past
// that is counted, not drawn — a player that far back can read the
// count and check again later.
const VISIBLE_WAITING_SETS = 10;

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function courtLine(court: DisplayCourt): string {
  if (court.state === "free") return "Available";
  return court.players.map((p) => p.name).join(", ") || "Guest";
}

// /rtv — "The Line". Owner (2026-09-17): players were double-stacking
// paddles in the physical box. This screen is the box: the three staged
// groups staff actually composed (small, one row), then everyone else
// still waiting packed into numbered sets of four in check-in order
// (the big grid), names coloured by skill so staff can stack even
// games. No paddles, no stacking, one name per person. Same data as
// /tv and /phone; only the framing (and the skill colour) differs.
export function RotationLineTvClient({
  initialData,
  refreshIntervalSeconds,
}: {
  initialData: DisplayData;
  refreshIntervalSeconds: number;
}) {
  const [data, setData] = useState(initialData);
  const [reconnecting, setReconnecting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const pollMs = Math.max(3, refreshIntervalSeconds) * 1000;
    async function poll() {
      try {
        const response = await fetch("/api/display?names=first", { cache: "no-store" });
        if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
        const json = (await response.json()) as DisplayData;
        if (cancelled) return;
        setData(json);
        setReconnecting(false);
        timeoutId = setTimeout(poll, pollMs);
      } catch {
        if (cancelled) return;
        setReconnecting(true);
        timeoutId = setTimeout(poll, RETRY_INTERVAL_MS);
      }
    }
    timeoutId = setTimeout(poll, pollMs);
    // A TV left on for days picks up deploys by reloading itself.
    const reloadId = setTimeout(() => window.location.reload(), RELOAD_AFTER_MS);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      clearTimeout(reloadId);
    };
  }, [refreshIntervalSeconds]);

  const line = buildLine(data);
  const staged = line.filter((set) => set.kind === "staged");
  const waiting = line.filter((set) => set.kind === "preview");
  const visibleWaiting = waiting.slice(0, VISIBLE_WAITING_SETS);
  const hiddenWaitingPlayers = waiting.slice(VISIBLE_WAITING_SETS).reduce((n, set) => n + set.names.length, 0);
  const waitingCount = data.queue.length + data.stagedGroups.reduce((n, g) => n + g.names.length, 0);

  return (
    <div className="bg-navy-900 text-bone flex min-h-svh flex-col gap-[1.5vh] px-[2.5vw] py-[1.5vh]">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[5vh] leading-none font-extrabold tracking-[-0.01em] uppercase">
            The Line
          </h1>
          <p className="text-slate mt-[0.4vh] text-[1.9vh]">
            Check in at the desk. Your set number is your place — no paddle stacking.
          </p>
        </div>
        <div className="flex items-end gap-[2vw]">
          <ul className="flex items-center gap-[1.2vw] text-[1.8vh]">
            {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
              <li key={level} className="flex items-center gap-[0.4vw]">
                <span aria-hidden="true" className={`size-[1.4vh] rounded-full ${OPEN_PLAY_SKILL_COLOR[level].dot}`} />
                <span className={OPEN_PLAY_SKILL_COLOR[level].text}>{OPEN_PLAY_SKILL_LEVELS[level].label}</span>
              </li>
            ))}
          </ul>
          <div className="text-right">
            <p className="font-jetbrains text-[4vh] leading-none font-bold">{timeFormatter.format(new Date(now))}</p>
            <p className={`text-[1.8vh] ${reconnecting ? "text-coral" : "text-green"}`}>
              {reconnecting ? "Reconnecting…" : `${waitingCount} waiting`}
            </p>
          </div>
        </div>
      </header>

      {/* Courts + the three staged groups share one compact row, so the
          waiting grid below gets the screen. */}
      <section
        className="grid gap-[1vw]"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, data.courts.length + Math.max(1, staged.length))}, minmax(0, 1fr))` }}
      >
        {data.courts.map((court) => (
          <div key={court.id} className="border-line bg-navy-800 rounded-xl border px-[1vw] py-[0.8vh]">
            <div className="flex items-center justify-between gap-2">
              <span className="font-display text-[2.4vh] font-bold uppercase">{court.name}</span>
              <span
                className={`rounded-full px-[0.8vw] py-[0.2vh] text-[1.5vh] font-bold uppercase ${
                  court.state === "free" ? "bg-green/15 text-green" : court.state === "op-pending" ? "bg-warning/15 text-warning" : "bg-coral/15 text-coral"
                }`}
              >
                {court.state === "free" ? "Open" : court.state === "op-pending" ? "Go" : "Playing"}
              </span>
            </div>
            <p className="mt-[0.4vh] truncate text-[1.9vh]">{courtLine(court)}</p>
          </div>
        ))}
        {staged.length === 0 ? (
          <div className="border-line/60 text-slate flex items-center justify-center rounded-xl border border-dashed text-[1.9vh]">
            Nothing staged yet
          </div>
        ) : (
          staged.map((set) => <SetCard key={set.number} set={set} compact />)
        )}
      </section>

      {waiting.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-slate text-[3.5vh]">
            {staged.length === 0 ? "Nobody waiting. Check in at the desk to play." : "Everyone waiting is already in a staged group."}
          </p>
        </div>
      ) : (
        <section className="grid flex-1 auto-rows-min grid-cols-5 gap-[1vw]">
          {visibleWaiting.map((set) => (
            <SetCard key={set.number} set={set} />
          ))}
          {hiddenWaitingPlayers > 0 ? (
            <div className="border-line/60 text-slate col-span-5 rounded-xl border border-dashed px-[1vw] py-[0.8vh] text-center text-[2vh]">
              + {hiddenWaitingPlayers} more waiting after Set {visibleWaiting[visibleWaiting.length - 1]?.number}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

function SetCard({ set, compact }: { set: LineSet; compact?: boolean }) {
  const staged = set.kind === "staged";
  return (
    <div
      className={`rounded-xl border px-[1vw] py-[0.8vh] ${staged ? "border-green/60 bg-green/10" : "border-line bg-navy-800"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-display leading-none font-extrabold ${compact ? "text-[3vh]" : "text-[4vh]"} ${staged ? "text-green" : "text-bone"}`}>
          {set.number}
        </span>
        <span className={`truncate text-[1.5vh] font-bold tracking-wide uppercase ${staged ? "text-green" : "text-slate"}`}>
          {staged ? set.label : "waiting"}
        </span>
      </div>
      {/* The court this staged set is expected to take: the next one to
          free up, in pipeline order. When Next up goes on court, After
          that becomes Next up and inherits the next court — automatic,
          nothing for staff to re-enter. */}
      {staged && set.court ? (
        <p className="text-bone/90 mt-[0.2vh] truncate text-[1.7vh] font-semibold">
          {set.court.courtName}
          <span className="text-slate font-normal">
            {" "}· {set.court.readyAt ? `~${timeFormatter.format(new Date(set.court.readyAt))}` : "open now"}
          </span>
        </p>
      ) : null}
      <ol className={`mt-[0.5vh] flex flex-col ${compact ? "gap-0 text-[1.9vh]" : "gap-[0.3vh] text-[2.5vh]"}`}>
        {set.players.map((player, index) => (
          <li key={`${player.name}-${index}`} className={`truncate leading-tight font-semibold ${skillTextClass(player.skill)}`}>
            {player.name}
          </li>
        ))}
        {Array.from({ length: Math.max(0, 4 - set.players.length) }).map((_, index) => (
          <li key={`empty-${index}`} className="text-slate/40 leading-tight">
            —
          </li>
        ))}
      </ol>
    </div>
  );
}
