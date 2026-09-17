"use client";

import { buildLine } from "@/features/display/lib/line-sets";
import styles from "@/app/display/[slug]/tv-display.module.css";
import type { DisplayData } from "@/services/display/display.service";
import { OPEN_PLAY_SKILL_COLOR, skillColor } from "@/types/open-play-skill-color";
import {
  OPEN_PLAY_SKILL_LEVEL_ORDER,
  OPEN_PLAY_SKILL_LEVELS,
} from "@/types/open-play-skill-levels";

const RACK_COUNT = 6;
const SPOTS_PER_RACK = 4;
const VISIBLE_WAITING = 16;

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

function cls(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

// /rtv, the big lower panel: six virtual paddle racks (owner,
// 2026-09-17), three across and two down, drawn with /tv's own "Next up"
// box styles so the two screens read the same. Each rack has four spots,
// like four paddles; an open spot shows a dash. Rack 1 is green (plays
// next); the rest are slate. A full rack shows the court it is expected
// to take; a short one says how many it still needs. Names are coloured
// by skill.
export function RackGrid({ data }: { data: DisplayData }) {
  const racks = buildLine(data).filter((set) => set.kind === "staged");
  const byLabel = new Map(racks.map((rack) => [rack.label, rack]));

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        gridTemplateRows: "repeat(2, minmax(0, 1fr))",
        gap: "1.2vh 1.2vw",
        flex: 1,
        minHeight: 0,
      }}
    >
      {Array.from({ length: RACK_COUNT }, (_, index) => {
        const label = `Rack ${index + 1}`;
        const rack = byLabel.get(label);
        const ready = rack && rack.missing === 0;
        return (
          <div
            key={label}
            className={cls(styles["next-up"], index > 0 && styles.later)}
            style={{ minHeight: 0, padding: "1vh 1vw" }}
          >
            <span className={styles.tag}>{label}</span>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.6vh",
              }}
            >
              <span className={styles.names} style={{ gap: "0.6vh 1vw" }}>
                {Array.from({ length: SPOTS_PER_RACK }, (_, i) => {
                  const player = rack?.players[i];
                  return (
                    <span
                      key={player ? `${player.name}-${i}` : `open-${i}`}
                      className={styles.n}
                      style={{
                        fontSize: "3.4vh",
                        color: player ? skillColor(player.skill) : "var(--line)",
                      }}
                    >
                      {player ? player.name : "—"}
                    </span>
                  );
                })}
              </span>
              {rack ? (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: "1.8vh",
                    color: ready ? "var(--bone)" : "var(--amber)",
                  }}
                >
                  {ready && rack.court
                    ? `${rack.court.courtName} · ${
                        rack.court.readyAt
                          ? `~${timeFormatter.format(new Date(rack.court.readyAt))}`
                          : "open now"
                      }`
                    : rack.missing > 0
                      ? `needs ${rack.missing} more`
                      : ""}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// /rtv, under the racks: everyone waiting who isn't on a rack yet,
// numbered in line order — /tv's own waiting row — with names coloured
// by skill and the colour legend beside it.
export function WaitingStrip({ data }: { data: DisplayData }) {
  const players = (data.queueUnits ?? data.queue.map((name) => [{ name, skill: null }])).flat();
  const shown = players.slice(0, VISIBLE_WAITING);
  const extra = players.length - shown.length;
  const onRacks = data.stagedGroups.reduce((n, g) => n + g.names.length, 0);

  return (
    <div
      className={cls(styles["q-row"], styles.rest)}
      style={{ flex: "0 0 auto", paddingTop: "1vh" }}
    >
      <div className={styles["q-label"]} style={{ minWidth: "11vw" }}>
        <em className={styles["count-n"]} style={{ marginTop: 0, fontSize: "3.6vh" }}>
          {players.length + onRacks}
        </em>
        <span>Waiting</span>
        <span
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.2vh 0.6vw",
            marginTop: "0.6vh",
            letterSpacing: 0,
          }}
        >
          {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
            <span key={level} style={{ color: OPEN_PLAY_SKILL_COLOR[level].hex }}>
              {OPEN_PLAY_SKILL_LEVELS[level].label}
            </span>
          ))}
        </span>
      </div>
      <div
        className={styles.waiting}
        style={{ gridTemplateColumns: "repeat(8, minmax(0, 1fr))", rowGap: "0.8vh" }}
      >
        {shown.map((player, i) => (
          <span
            key={`${player.name}-${i}`}
            className={styles.w}
            style={{ color: skillColor(player.skill) }}
          >
            <i>{i + 1}</i>
            {player.name}
          </span>
        ))}
        {extra > 0 && <span className={cls(styles.w, styles.more)}>+{extra} more</span>}
      </div>
    </div>
  );
}
