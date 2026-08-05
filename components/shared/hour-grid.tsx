"use client";

import { cn } from "@/lib/utils";

// Presentation-only: hours in, a per-hour state in, a click out. No
// court/price/reserve/duration-cap baked in — that's what made the
// public homepage grid (features/bookings/components/availability-board.tsx)
// the wrong thing to import here rather than fork. Built generic enough
// that a future consumer (e.g. the staff booking form's advance mode)
// can layer a different selection rule (single contiguous range with a
// duration cap) on top of the same rendering, by passing a different
// cellState/onHourClick pair — not a second component.
// "booked" is deliberately NOT "disabled" — a booked hour must stay
// clickable (coach-availability-manager.tsx's own conflict-warning
// dialog fires from that click), just visually distinct from a plain
// open/closed toggle so it can never be mistaken for either.
export type HourCellState = "on" | "off" | "disabled" | "booked";

export interface HourGridProps {
  hours: number[];
  cellState: (hour: number) => HourCellState;
  onHourClick?: (hour: number) => void;
  hourLabel?: (hour: number) => string;
  // Owner request (2026-08-05): "add the name of the person who
  // booked" — a second, smaller line under the time for a booked hour.
  // Optional/undefined for every other state; only coach-availability-
  // manager.tsx currently supplies one.
  cellSubLabel?: (hour: number) => string | undefined;
  className?: string;
}

function defaultHourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = ((hour + 11) % 12) + 1;
  return `${twelveHour}:00 ${period}`;
}

export function HourGrid({
  hours,
  cellState,
  onHourClick,
  hourLabel = defaultHourLabel,
  cellSubLabel,
  className,
}: HourGridProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6", className)}>
      {hours.map((hour) => {
        const state = cellState(hour);
        const isDisabled = state === "disabled";
        const label = hourLabel(hour);
        const subLabel = cellSubLabel?.(hour);

        return (
          <button
            key={hour}
            type="button"
            disabled={isDisabled}
            aria-pressed={state === "on"}
            aria-label={`${label}, ${
              state === "booked"
                ? `booked${subLabel ? ` by ${subLabel}` : ""}`
                : state === "on"
                  ? "selected"
                  : isDisabled
                    ? "unavailable"
                    : "not selected"
            }`}
            onClick={() => onHourClick?.(hour)}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              state === "on" && "bg-primary text-primary-foreground border-primary",
              state === "off" &&
                "bg-background hover:bg-accent hover:text-accent-foreground border-input cursor-pointer",
              isDisabled && "bg-muted text-muted-foreground cursor-not-allowed border-transparent opacity-60",
              // Reported live (2026-08-04): a booked hour rendered
              // identically to a plain open one — no visual signal a real
              // session already sat there, which is exactly what made a
              // coach worry the system could double-book them. court-blue
              // is this app's established "currently occupied" color
              // (Badge's "status" variant, the Court Status panel's
              // "Occupied") — never used for a plain toggle state. Solid
              // fill (not a translucent tint) — reported live, 2026-08-05,
              // the /15 tint read as "barely there" next to the public
              // grid's own solid Booked cells; court-blue-foreground is
              // the token's own paired contrast color, same pattern as
              // "on" above using primary-foreground.
              state === "booked" &&
                "bg-court-blue text-court-blue-foreground border-court-blue hover:bg-court-blue/90 cursor-pointer",
            )}
          >
            <span>{label}</span>
            {subLabel ? (
              <span className="max-w-full truncate text-[10px] font-normal opacity-85">
                {subLabel}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
