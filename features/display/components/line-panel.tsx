"use client";

import { buildLine, type LineSet } from "@/features/display/lib/line-sets";
import type { DisplayData } from "@/services/display/display.service";
import { OPEN_PLAY_SKILL_COLOR, skillTextClass } from "@/types/open-play-skill-color";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

// How many waiting sets fit: two rows of five. Anything past that is
// counted, not drawn.
const VISIBLE_WAITING_SETS = 10;

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

// The Line — the queue as numbered sets of four, in place of the paddle
// box (owner, 2026-09-17). Rendered by TvDisplayClient in its "line"
// variant (/rtv) below the same court cards, timers and announcements
// /tv has; this is only the lower panel. Staged groups come first with
// their expected court; a set short of four says how many it needs and
// gets no court until it is full.
export function LinePanel({ data }: { data: DisplayData }) {
  const line = buildLine(data);
  const staged = line.filter((set) => set.kind === "staged");
  const waiting = line.filter((set) => set.kind === "preview");
  const visibleWaiting = waiting.slice(0, VISIBLE_WAITING_SETS);
  const hiddenWaitingPlayers = waiting.slice(VISIBLE_WAITING_SETS).reduce((n, set) => n + set.names.length, 0);
  const waitingCount = data.queue.length + data.stagedGroups.reduce((n, g) => n + g.names.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[1.2vh]">
      <div className="flex items-center justify-between gap-4">
        <p className="text-[1.9vh]">
          <span className="font-bold uppercase">The line</span>
          <span className="text-slate"> · {waitingCount} waiting · your set number is your place, no paddle stacking</span>
        </p>
        <ul className="flex items-center gap-[1.2vw] text-[1.7vh]">
          {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
            <li key={level} className="flex items-center gap-[0.4vw]">
              <span aria-hidden="true" className={`size-[1.3vh] rounded-full ${OPEN_PLAY_SKILL_COLOR[level].dot}`} />
              <span className={OPEN_PLAY_SKILL_COLOR[level].text}>{OPEN_PLAY_SKILL_LEVELS[level].label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-3 gap-[1vw]">
        {(["Next up", "After that", "Then"] as const).map((label, index) => {
          const set = staged[index];
          return set ? (
            <SetCard key={label} set={set} compact />
          ) : (
            <div key={label} className="border-line/60 text-slate flex items-center justify-center rounded-xl border border-dashed py-[1vh] text-[1.8vh]">
              {label}: —
            </div>
          );
        })}
      </div>

      {waiting.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-slate text-[3vh]">
            {staged.length === 0 ? "Nobody waiting. Check in at the desk to play." : "Everyone waiting is already in a staged group."}
          </p>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-5 gap-[1vw] overflow-hidden">
          {visibleWaiting.map((set) => (
            <SetCard key={set.number} set={set} />
          ))}
          {hiddenWaitingPlayers > 0 ? (
            <div className="border-line/60 text-slate col-span-5 rounded-xl border border-dashed px-[1vw] py-[0.6vh] text-center text-[1.8vh]">
              + {hiddenWaitingPlayers} more waiting after Set {visibleWaiting[visibleWaiting.length - 1]?.number}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SetCard({ set, compact }: { set: LineSet; compact?: boolean }) {
  const staged = set.kind === "staged";
  const ready = staged && set.missing === 0;
  return (
    <div className={`rounded-xl border px-[1vw] py-[0.7vh] ${ready ? "border-green/60 bg-green/10" : staged ? "border-amber-400/60 bg-amber-400/10" : "border-line bg-navy-800"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`leading-none font-extrabold ${compact ? "text-[2.8vh]" : "text-[3.6vh]"} ${ready ? "text-green" : staged ? "text-amber-400" : "text-bone"}`}>
          {set.number}
        </span>
        <span className={`truncate text-[1.5vh] font-bold tracking-wide uppercase ${ready ? "text-green" : staged ? "text-amber-400" : "text-slate"}`}>
          {staged ? set.label : "waiting"}
          {set.missing > 0 && staged ? ` · needs ${set.missing} more` : ""}
        </span>
      </div>
      {/* The court this set is expected to take: the next to free up, in
          pipeline order, full sets only. When Next up goes on court the
          set behind it moves up and inherits the next court. */}
      {ready && set.court ? (
        <p className="text-bone/90 mt-[0.2vh] truncate text-[1.7vh] font-semibold">
          {set.court.courtName}
          <span className="text-slate font-normal">
            {" "}· {set.court.readyAt ? `~${timeFormatter.format(new Date(set.court.readyAt))}` : "open now"}
          </span>
        </p>
      ) : null}
      <ol className={`mt-[0.4vh] flex flex-col ${compact ? "gap-0 text-[1.9vh]" : "gap-[0.2vh] text-[2.3vh]"}`}>
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
