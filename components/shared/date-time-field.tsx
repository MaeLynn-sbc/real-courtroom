"use client";

import { ClockTimeSelect } from "@/components/shared/clock-time-select";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Replaces <input type="datetime-local">, which is unreliable on phones
// (owner, 2026-10-05). A date field plus ClockTimeSelect. Value is
// "YYYY-MM-DDTHH:MM" or "" — exactly what datetime-local produced, so a
// form's parsing and schema stay unchanged.
export function DateTimeField({
  value,
  onChange,
  minuteStep = 5,
  id,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  minuteStep?: number;
  id?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [datePart = "", timePart = ""] = value ? value.split("T") : [];
  // A half-filled value keeps whichever half was picked ("2026-10-05T" or
  // "T08:00") so choosing the time first doesn't lose it. Neither parses as
  // a date, so the form's own validation still asks for the missing half.
  const combine = (date: string, time: string) =>
    date || time ? `${date}T${time.slice(0, 5)}` : "";

  return (
    <div className={cn("grid grid-cols-1 gap-1.5 sm:grid-cols-2", className)}>
      <Input
        id={id}
        type="date"
        aria-label={ariaLabel ? `${ariaLabel} date` : undefined}
        disabled={disabled}
        value={datePart}
        onChange={(event) => onChange(combine(event.target.value, timePart))}
      />
      <ClockTimeSelect
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
        minuteStep={minuteStep}
        disabled={disabled}
        value={timePart.slice(0, 5)}
        onChange={(time) => onChange(combine(datePart, time))}
      />
    </div>
  );
}
