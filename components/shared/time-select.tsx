"use client";

import { cn } from "@/lib/utils";

// A drop-in for <Input type="time"> that works on phones (owner, 2026-10-05:
// "I can't change the time using my phone when I click on the time"). The
// native time input is unreliable on mobile browsers — the public booking
// form already replaced it for the same reason. A native <select> opens
// the phone's own picker wheel everywhere. Value stays "HH:MM", so callers
// only swap the component.

// Whole hours from 7 AM, when the facility opens, through midnight (owner,
// 2026-10-05: "no need for 30 min", "the initial is 7:00 am").
const FIRST_HOUR = 7;

function formatLabel(value: string): string {
  const [hours, minutes] = value.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0
    ? `${displayHour} ${period}`
    : `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function hourOptions(firstHour: number): string[] {
  const hours = Array.from(
    { length: 24 - firstHour },
    (_, index) => `${String(firstHour + index).padStart(2, "0")}:00`,
  );
  return firstHour === 0 ? hours : [...hours, "00:00"];
}

export function TimeSelect({
  value,
  onChange,
  firstHour = FIRST_HOUR,
  emptyLabel,
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  // Settings (facility hours) can legitimately start before opening.
  firstHour?: number;
  // When set, a blank choice with this label is always offered, so a
  // field that means "none" when empty can be cleared again.
  emptyLabel?: string;
  className?: string;
  id?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  // An existing value outside the list (e.g. 6:30 PM saved earlier)
  // still shows as itself, first, instead of silently snapping.
  const base = hourOptions(firstHour);
  const options = value && !base.includes(value) ? [value, ...base] : base;

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "border-input dark:bg-input/30 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2 text-base outline-none md:text-sm pointer-coarse:h-10",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {emptyLabel !== undefined ? (
        <option value="">{emptyLabel}</option>
      ) : !value ? (
        <option value="">Select time</option>
      ) : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {formatLabel(option)}
        </option>
      ))}
    </select>
  );
}
