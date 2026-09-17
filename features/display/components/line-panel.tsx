"use client";

import { buildLine } from "@/features/display/lib/line-sets";
import styles from "@/app/display/[slug]/tv-display.module.css";
import { BASE_RACK_SLOTS, stagedSlotLabel } from "@/lib/staged-slots";
import type { DisplayData } from "@/services/display/display.service";
import { skillColor } from "@/types/open-play-skill-color";

const SPOTS_PER_RACK = 4;

const timeFormatter = new Intl.DateTimeFormat("en-PH", {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// /rtv's extra column (owner, 2026-09-17): the six virtual paddle racks,
// stacked down the right side of an otherwise unchanged /tv screen. They
// queue behind Next up / After that / Then — when Next up goes on court,
// Rack 1 moves into Then. Drawn with /tv's own box styles; each rack has
// four spots (a dash when open), names coloured by skill, and a full rack
// shows the court it's expected to take.
export function RackColumn({ data }: { data: DisplayData }) {
  const line = buildLine(data);
  // Racks 1-6 only. Racks 7-12 are staff-side overflow and never appear
  // on a TV (owner, 2026-09-18).
  const racks = BASE_RACK_SLOTS.map((slot) => ({
    label: stagedSlotLabel(slot),
    set: line.find((entry) => entry.kind === "staged" && entry.label === stagedSlotLabel(slot)),
  }));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.8vh",
        width: "20vw",
        flexShrink: 0,
        minHeight: 0,
        // Clears the fixed "Updated …" label in the bottom-right corner.
        paddingBottom: "2.6vh",
      }}
    >
      {racks.map(({ label, set }) => {
        const ready = set && set.missing === 0;
        return (
          <div
            key={label}
            className={`${styles["next-up"]} ${styles.later}`}
            style={{ flex: 1, minHeight: 0, padding: "0.6vh 0.8vw", gap: "0.8vw" }}
          >
            <span className={styles.tag} style={{ fontSize: "1.2vh" }}>
              {label}
            </span>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: "0.3vh",
              }}
            >
              <span className={styles.names} style={{ gap: "0.2vh 0.8vw" }}>
                {Array.from({ length: SPOTS_PER_RACK }, (_, i) => {
                  const player = set?.players[i];
                  return (
                    <span
                      key={player ? `${player.name}-${i}` : `open-${i}`}
                      className={styles.n}
                      style={{
                        fontSize: "2.2vh",
                        color: player ? (skillColor(player.skill) ?? "var(--bone)") : "var(--line)",
                      }}
                    >
                      {player ? player.name : "—"}
                    </span>
                  );
                })}
              </span>
              {set ? (
                <span
                  style={{
                    fontFamily: "var(--mono)",
                    fontSize: "1.3vh",
                    color: ready ? "var(--bone)" : "var(--amber)",
                  }}
                >
                  {ready && set.court
                    ? `${set.court.courtName} · ${
                        set.court.readyAt
                          ? `~${timeFormatter.format(new Date(set.court.readyAt))}`
                          : "open now"
                      }`
                    : set.missing > 0
                      ? `needs ${set.missing} more`
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
