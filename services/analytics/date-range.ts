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
  const custom =
    typeof fromParam === "string" && typeof toParam === "string"
      ? { from: new Date(fromParam), to: new Date(toParam) }
      : undefined;

  return resolveDateRange(preset, custom);
}
