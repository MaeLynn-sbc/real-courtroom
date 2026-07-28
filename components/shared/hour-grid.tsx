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
export type HourCellState = "on" | "off" | "disabled";

export interface HourGridProps {
  hours: number[];
  cellState: (hour: number) => HourCellState;
  onHourClick?: (hour: number) => void;
  hourLabel?: (hour: number) => string;
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
  className,
}: HourGridProps) {
  return (
    <div className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6", className)}>
      {hours.map((hour) => {
        const state = cellState(hour);
        const isDisabled = state === "disabled";
        const label = hourLabel(hour);

        return (
          <button
            key={hour}
            type="button"
            disabled={isDisabled}
            aria-pressed={state === "on"}
            aria-label={`${label}, ${state === "on" ? "selected" : isDisabled ? "unavailable" : "not selected"}`}
            onClick={() => onHourClick?.(hour)}
            className={cn(
              "rounded-lg border px-2 py-2.5 text-sm font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              state === "on" && "bg-primary text-primary-foreground border-primary",
              state === "off" &&
                "bg-background hover:bg-accent hover:text-accent-foreground border-input cursor-pointer",
              isDisabled && "bg-muted text-muted-foreground cursor-not-allowed border-transparent opacity-60",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
