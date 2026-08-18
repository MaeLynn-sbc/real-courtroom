import { computeBusinessDate } from "@/lib/business-date";

export type DateRangePreset = "TODAY" | "7_DAYS" | "30_DAYS" | "90_DAYS" | "CUSTOM";

export interface DateRange {
  from: Date;
  to: Date;
}

// Pure — no Prisma import, unit-tested directly (computeBusinessDate is
// equally pure, so importing it doesn't change that). `to` is always
// "now" (or the custom range's end) so every report/analytics query has
// a stable, inclusive-of-today upper bound. CUSTOM requires both
// custom.from and custom.to — falls back to 30 days if either is
// missing rather than throwing, since the UI always provides both
// together.
//
// Owner-directed consolidation (2026-08-12): TODAY used to be literal
// calendar midnight, rollover-hour blind — the root cause of "the
// attendant dashboard resetting mid-shift" at the stroke of midnight
// even though the business day (and the shift) hadn't actually turned
// over yet. Now uses the SAME computeBusinessDate every other correct
// part of this app already uses (Open Play, the TV display). Callers
// are responsible for fetching the real rolloverHour via
// settingsService.getCourtHours() — this function stays pure/DB-free,
// same reasoning assertIsCurrentBusinessDate's own comment gives.
// rolloverHour is REQUIRED, with no default (owner decision 2026-08-18).
// It previously defaulted to 0 — literal midnight — while
// DEFAULT_COURT_HOURS says 3, so one concept had two different silent
// fallbacks depending on which door you came through. No production
// caller ever relied on the 0; only tests did. Making it required means
// the setting is the single source of truth and a caller with no
// rollover-hour context has to say so out loud rather than quietly
// getting midnight.
export function resolveDateRange(
  preset: DateRangePreset,
  // custom and now are required POSITIONS that accept undefined, rather
  // than optional parameters: a required parameter cannot follow an
  // optional one, and rolloverHour is now required. Callers pass
  // undefined explicitly — which every app caller already did.
  custom: { from: Date; to: Date } | undefined,
  now: Date | undefined,
  rolloverHour: number,
): DateRange {
  if (preset === "CUSTOM" && custom) {
    return { from: custom.from, to: custom.to };
  }

  const resolvedNow = now ?? new Date();
  const to = resolvedNow;
  const from = new Date(resolvedNow);

  switch (preset) {
    case "TODAY":
      from.setTime(computeBusinessDate(resolvedNow, rolloverHour).getTime());
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
  rolloverHour: number,
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

  return resolveDateRange(preset, custom, undefined, rolloverHour);
}
