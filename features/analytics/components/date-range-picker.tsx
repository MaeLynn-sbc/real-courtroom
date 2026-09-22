"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PRESET_LABELS: Record<string, string> = {
  TODAY: "Today",
  "7_DAYS": "Last 7 days",
  "30_DAYS": "Last 30 days",
  "90_DAYS": "Last 90 days",
  MONTH: "Whole month",
  CUSTOM: "Custom range",
};

// "2026-08". Defaults the month input to the month we are in, so picking
// "Whole month" lands somewhere real instead of blank — matching
// resolveDateRange's own no-month-given fallback.
function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Reads/writes the date range as URL search params (preset, from, to) so
// the server component page it sits on can read them directly via its
// searchParams prop and call resolveDateRange — no client state store
// needed, and the range survives a page refresh/share link.
export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const preset = searchParams.get("preset") ?? "30_DAYS";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const month = searchParams.get("month") ?? currentMonthValue();

  function updateParams(next: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    router.replace(`${pathname}?${params.toString()}`);
  }

  function handlePresetChange(value: string | null) {
    if (!value) {
      return;
    }
    if (value === "CUSTOM") {
      updateParams({ preset: value, month: null });
    } else if (value === "MONTH") {
      // from/to cleared: a month and a custom range are two ways of
      // saying the same thing, and leaving both set makes the URL lie
      // about which one is in effect.
      updateParams({ preset: value, from: null, to: null, month });
    } else {
      updateParams({ preset: value, from: null, to: null, month: null });
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="date-range-preset">Date range</Label>
        <Select value={preset} onValueChange={handlePresetChange}>
          <SelectTrigger id="date-range-preset" className="w-40">
            <SelectValue>{(value: string) => PRESET_LABELS[value] ?? value}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PRESET_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {preset === "MONTH" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="date-range-month">Month</Label>
          <Input
            id="date-range-month"
            type="month"
            value={month}
            onChange={(event) => updateParams({ month: event.target.value })}
          />
        </div>
      ) : null}
      {preset === "CUSTOM" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date-range-from">From</Label>
            <Input
              id="date-range-from"
              type="date"
              value={from}
              onChange={(event) => updateParams({ from: event.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date-range-to">To</Label>
            <Input
              id="date-range-to"
              type="date"
              value={to}
              onChange={(event) => updateParams({ to: event.target.value })}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
