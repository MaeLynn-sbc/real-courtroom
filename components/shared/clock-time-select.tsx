"use client";

import { cn } from "@/lib/utils";

// Hour + minute dropdowns for times that need minutes (payroll clock-in/out,
// shift templates, a shift's actual end). The native <input type="time">
// is unreliable on phones (owner, 2026-10-05) and TimeSelect is whole hours
// only. Native <select>s open the phone's own picker wheel. Value is
// "HH:MM" (24-hour) or "" — the same string <input type="time"> produced,
// so callers swap the component and nothing else.

const SELECT_CLASS =
  "border-input dark:bg-input/30 h-8 pointer-coarse:h-10 min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none md:text-sm focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:opacity-50";

function hourLabel(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 === 0 ? 12 : hour % 12} ${period}`;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function ClockTimeSelect({
  value,
  onChange,
  minuteStep = 5,
  emptyLabel,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
  // When set, the hour dropdown always offers a blank choice with this
  // label, and choosing it clears the whole value.
  emptyLabel?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [hourPart = "", minutePart = ""] = value ? value.split(":") : [];
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, index) =>
    pad(index * minuteStep),
  );
  // A saved minute off the step (e.g. 08:07 from a real clock-in) still
  // shows as itself instead of silently snapping.
  const minuteOptions =
    minutePart && !minutes.includes(minutePart) ? [...minutes, minutePart].sort() : minutes;

  return (
    <div className={cn("grid grid-cols-2 gap-1.5", className)} role="group" aria-label={ariaLabel}>
      <select
        id={id}
        aria-label={ariaLabel ? `${ariaLabel} hour` : "Hour"}
        className={SELECT_CLASS}
        disabled={disabled}
        value={hourPart}
        onChange={(event) => {
          const hour = event.target.value;
          onChange(hour ? `${hour}:${minutePart || "00"}` : "");
        }}
      >
        {emptyLabel !== undefined ? (
          <option value="">{emptyLabel}</option>
        ) : !hourPart ? (
          <option value="">Hour</option>
        ) : null}
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={pad(hour)}>
            {hourLabel(hour)}
          </option>
        ))}
      </select>
      <select
        aria-label={ariaLabel ? `${ariaLabel} minute` : "Minute"}
        className={SELECT_CLASS}
        disabled={disabled || !hourPart}
        value={minutePart}
        onChange={(event) => onChange(`${hourPart}:${event.target.value}`)}
      >
        {!minutePart ? <option value="">Min</option> : null}
        {minuteOptions.map((minute) => (
          <option key={minute} value={minute}>
            :{minute}
          </option>
        ))}
      </select>
    </div>
  );
}
