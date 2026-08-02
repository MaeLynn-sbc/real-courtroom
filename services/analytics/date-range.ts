export type DateRangePreset = "TODAY" | "7_DAYS" | "30_DAYS" | "90_DAYS" | "CUSTOM";

export interface DateRange {
  from: Date;
  to: Date;
}

// Pure — no Prisma import, unit-tested directly. `to` is always "now" (or
// the custom range's end) so every report/analytics query has a stable,
// inclusive-of-today upper bound. CUSTOM requires both custom.from and
// custom.to — falls back to 30 days if either is missing rather than
// throwing, since the UI always provides both together.
export function resolveDateRange(
  preset: DateRangePreset,
  custom?: { from: Date; to: Date },
  now: Date = new Date(),
): DateRange {
  if (preset === "CUSTOM" && custom) {
    return { from: custom.from, to: custom.to };
  }

  const to = now;
  const from = new Date(now);

  switch (preset) {
    case "TODAY":
      from.setHours(0, 0, 0, 0);
      break;
    case "7_DAYS":
      from.setDate(from.getDate() - 7);
      break;
    case "90_DAYS":
      from.setDate(from.getDate() - 90);
      break;
    case "30_DAYS":
    case "CUSTOM":
      from.setDate(from.getDate() - 30);
      break;
  }

  return { from, to };
}

function endOfLocalDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

const PRESET_VALUES: DateRangePreset[] = ["TODAY", "7_DAYS", "30_DAYS", "90_DAYS", "CUSTOM"];

function isDateRangePreset(value: string): value is DateRangePreset {
  return (PRESET_VALUES as string[]).includes(value);
}

// Reused by every page with a DateRangePicker (dashboard, reports,
// analytics) — those pages all encode the range the same way in their URL
// search params, so parsing it into a resolved DateRange belongs here
// alongside resolveDateRange rather than being copy-pasted three times.
export function resolveDateRangeFromSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): DateRange {
  const presetParam = searchParams.preset;
  const preset =
    typeof presetParam === "string" && isDateRangePreset(presetParam) ? presetParam : "30_DAYS";

  const fromParam = searchParams.from;
  const toParam = searchParams.to;
  // Reported live: a "custom range" of From=To=Aug 1 returned almost no
  // data for a day with real ₱8,000+ in sales. Root cause: `new
  // Date("2026-08-01")` (a bare date-only string, straight from an
  // <input type="date">) is parsed as UTC midnight by spec, REGARDLESS
  // of the process's own timezone — unlike `new Date(y, m, d)` or a
  // "T00:00:00"-suffixed string, both of which parse as local (this
  // process runs TZ=Asia/Manila, UTC+8). UTC midnight Aug 1 is 8:00 AM
  // Manila Aug 1, so `to` cut off virtually the entire business day, and
  // `from`/`to` being equal made the window a near-zero-width instant
  // rather than the whole day. Appending "T00:00:00" forces local-time
  // parsing (same idiom already used in app/availability/page.tsx and
  // the cash/gcash reconciliation actions); `to` is then pushed to the
  // end of that same local day so a single selected day is fully
  // inclusive instead of only its first instant.
  const custom =
    typeof fromParam === "string" && typeof toParam === "string"
      ? {
          from: new Date(`${fromParam}T00:00:00`),
          to: endOfLocalDay(new Date(`${toParam}T00:00:00`)),
        }
      : undefined;

  return resolveDateRange(preset, custom);
}
