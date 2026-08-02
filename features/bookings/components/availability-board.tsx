"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn, formatCurrency } from "@/lib/utils";

export interface BoardCourt {
  id: string;
  name: string;
  priceCents: number | null;
}

export interface BoardCell {
  state: "unavailable" | "openPlay" | "past" | "booked" | "available";
}

interface AvailabilityBoardProps {
  courts: BoardCourt[];
  hours: number[];
  cells: Record<string, BoardCell>;
  dateValue: string;
  dateLabel: string;
}

interface Selection {
  courtId: string;
  hours: number[];
}

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = ((hour + 11) % 12) + 1;
  return `${twelveHour}:00 ${period}`;
}

function toTimeValue(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

// One slot renders as a miniature court: navy fill, a bottom-edge stripe
// mirrors docs/design-reference.html's .slot styling. Four states read
// as four genuinely distinct color families, not shades of one hue:
//   - available (open, tap to hold): solid white fill, dark gray text
//     (owner request, 2026-08-02 — was bone/navy-900), label in caps —
//     comfortably clears WCAG AA's 4.5:1 for normal text.
//   - booked: solid sky-400 (Tailwind, not a custom brand token — same
//     precedent as the dashboard's RecordCard ramps using stock
//     Tailwind shades for functional/state color, not brand identity),
//     navy-900 text. Was a ~15%-opacity tint that read as too faint/
//     transparent to the owner live; solid fill fixes that — 8.57:1
//     contrast.
//   - open play (walk-in, not booked through this grid): solid
//     emerald-700, white text — deliberately a DIFFERENT green from
//     the brand --green used by the Held/selected state and the
//     Available stripe accent below, so an open-play cell is never
//     mistaken for a currently-held one. 5.48:1 contrast.
//   - past / unavailable (maintenance): neutral/muted, deliberately not
//     part of the four-color system — not bookable states competing
//     for attention, just dimmed out.
function cellClasses(state: BoardCell["state"], isSelected: boolean): string {
  if (isSelected) {
    return "bg-green text-navy-900 border-green font-bold after:bg-navy-900/30";
  }
  switch (state) {
    case "available":
      return "bg-white text-gray-600 border-white font-bold uppercase tracking-[0.04em] hover:-translate-y-px after:bg-green after:opacity-70 cursor-pointer";
    case "openPlay":
      return "bg-emerald-700 border-emerald-500 text-white text-[12px] font-bold tracking-[0.1em] uppercase after:bg-emerald-300 after:opacity-70 cursor-default";
    case "past":
      return "bg-navy-700/25 border-transparent text-slate/40 cursor-not-allowed after:bg-slate after:opacity-10";
    case "booked":
      return "bg-sky-400 border-sky-500 text-navy-900 font-bold cursor-not-allowed after:bg-sky-600 after:opacity-70";
    default:
      // unavailable (maintenance)
      return "bg-navy-700/40 border-transparent text-slate/50 cursor-not-allowed after:bg-slate after:opacity-20";
  }
}

function cellLabel(state: BoardCell["state"], isSelected: boolean): string {
  if (isSelected) {
    return "Held";
  }
  switch (state) {
    case "available":
      return "Available";
    case "openPlay":
      return "Open play";
    case "past":
      // Never a bare dash — a real word, so nothing in the grid looks
      // like a cryptic/inconsistent placeholder. Still visually muted
      // (see cellClasses) and non-interactive — an elapsed hour today
      // isn't the same state as a genuinely open one.
      return "Past";
    case "unavailable":
      return "Unavailable";
    default:
      return "Booked";
  }
}

export function AvailabilityBoard({
  courts,
  hours,
  cells,
  dateValue,
  dateLabel,
}: AvailabilityBoardProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Found live on a phone: the grid's real width (560px min) overflows
  // any phone viewport, but overflow-x-auto alone gives zero visual
  // signal that anything's off-screen — Court 3 (or even the tail of
  // Court 2) reads as simply not existing, not as "scroll for more."
  // Driven by an actual measured overflow check, not a guessed CSS
  // breakpoint, so it's correct regardless of exact viewport width or
  // how many courts there are. atEnd additionally hides the hint once
  // the visitor has already scrolled all the way — it's done its job.
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isAtEnd, setIsAtEnd] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    function checkOverflow() {
      if (!el) return;
      setHasOverflow(el.scrollWidth > el.clientWidth + 1);
      setIsAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
    }

    checkOverflow();
    const resizeObserver = new ResizeObserver(checkOverflow);
    resizeObserver.observe(el);
    el.addEventListener("scroll", checkOverflow, { passive: true });
    return () => {
      resizeObserver.disconnect();
      el.removeEventListener("scroll", checkOverflow);
    };
  }, []);

  const selectedHours = useMemo(
    () => (selection ? [...selection.hours].sort((a, b) => a - b) : []),
    [selection],
  );

  function handleCellClick(courtId: string, hour: number) {
    setSelection((current) => {
      if (!current || current.courtId !== courtId) {
        return { courtId, hours: [hour] };
      }
      if (current.hours.includes(hour)) {
        const remaining = current.hours.filter((h) => h !== hour);
        return remaining.length > 0 ? { courtId, hours: remaining } : null;
      }
      const merged = [...current.hours, hour].sort((a, b) => a - b);
      const isContiguous = merged.every((h, index) => index === 0 || h === merged[index - 1] + 1);
      if (merged.length <= 2 && isContiguous) {
        return { courtId, hours: merged };
      }
      return { courtId, hours: [hour] };
    });
  }

  function handleClear() {
    setSelection(null);
  }

  function handleReserve() {
    if (!selection || selectedHours.length === 0) {
      return;
    }
    const durationMinutes = selectedHours.length * 60;
    const time = toTimeValue(selectedHours[0]);
    router.push(
      `/book?courtId=${selection.courtId}&date=${dateValue}&time=${time}&durationMinutes=${durationMinutes}`,
    );
  }

  const selectedCourt = selection
    ? courts.find((court) => court.id === selection.courtId)
    : undefined;
  const total = selectedCourt ? (selectedCourt.priceCents ?? 0) * selectedHours.length : 0;
  const isTrayUp = selectedHours.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Chunky grid: tall rows (min-h-[46px]) so each slot reads as a
          solid block, not a thin bar — reverted from an earlier compact
          pass (24px rows) the owner didn't want. Header/time-label sizing
          scaled up to match (py-3/py-1.5, bigger type). */}
      {hasOverflow ? (
        <p className="text-slate font-jetbrains flex items-center gap-1.5 text-[11px] tracking-[0.08em] uppercase">
          <span aria-hidden="true">←→</span>
          Swipe to see all {courts.length} courts
        </p>
      ) : null}
      <div className="border-line bg-navy-800 relative overflow-hidden rounded-2xl border">
        <div
          ref={scrollRef}
          role="region"
          aria-label="Court availability grid — scroll horizontally to see every court"
          tabIndex={hasOverflow ? 0 : -1}
          className="focus-visible:outline-green overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
        >
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-navy-700 border-line text-slate font-jetbrains sticky top-16 z-10 border-b px-4 py-3 text-left text-[11px] font-normal tracking-[0.16em] uppercase"
                >
                  Time
                </th>
                {courts.map((court) => (
                  <th
                    key={court.id}
                    scope="col"
                    className="bg-navy-700 border-line font-display text-bone sticky top-16 z-10 border-b px-2 py-3 text-center text-[16px] font-extrabold tracking-[0.06em] uppercase"
                  >
                    {court.name}
                    <small className="font-jetbrains text-slate mt-0.5 block text-[10px] font-normal tracking-[0.16em] normal-case">
                      Indoor
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Spacer row — absorbs the sticky header's static-to-stuck
                  scroll transition instead of the real first row. Found
                  live: the sticky <th> cells (top-16, ~65-66px stuck
                  height once engaged) are taller than one data row
                  (~59px). Scrolling the page so the table's own top
                  lands near the viewport top makes the header snap into
                  its stuck position while the first real row (7:00 AM)
                  is still in that same on-screen band — the opaque,
                  higher-z-index header then fully covers it, not
                  partially: the row exists, is "visible" by any DOM-
                  only check, and is completely unreachable to an actual
                  viewer. A height greater than the header's stuck
                  height guarantees the transition consumes THIS row
                  (which has nothing to lose) before it can ever reach
                  7:00 AM. Same background as the card, no border, no
                  content — invisible at rest, only ever matters mid-
                  scroll. */}
              <tr aria-hidden="true">
                <td colSpan={courts.length + 1} className="bg-navy-800 h-[72px] p-0" />
              </tr>
              {hours.map((hour) => (
                <tr key={hour} className="border-line border-t">
                  <td className="bg-navy-700 font-jetbrains text-bone w-28 px-4 py-1.5 text-sm font-medium whitespace-nowrap sm:w-32">
                    {hourLabel(hour)}
                  </td>
                  {courts.map((court) => {
                    const cell = cells[`${hour}:${court.id}`];
                    const isSelected =
                      selection?.courtId === court.id && selection.hours.includes(hour);
                    const label = cellLabel(cell.state, isSelected);

                    if (cell.state !== "available" && !isSelected) {
                      return (
                        <td key={court.id} className="p-1.5">
                          <div
                            className={cn(
                              "font-jetbrains relative flex min-h-[46px] items-center justify-center overflow-hidden rounded-lg border text-[13px] font-medium",
                              "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                              cellClasses(cell.state, false),
                            )}
                            aria-label={`Court ${court.name}, ${hourLabel(hour)}, ${label.toLowerCase()}`}
                          >
                            {label}
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={court.id} className="p-1.5">
                        <button
                          type="button"
                          onClick={() => handleCellClick(court.id, hour)}
                          aria-pressed={isSelected}
                          aria-label={`Court ${court.name}, ${hourLabel(hour)}, ${
                            isSelected
                              ? "held, tap to release"
                              : `available, ${formatCurrency(court.priceCents ?? 0)}`
                          }`}
                          className={cn(
                            "font-jetbrains relative flex min-h-[46px] w-full items-center justify-center overflow-hidden rounded-lg border text-[13px] font-medium transition-all",
                            "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                            "focus-visible:outline-green focus-visible:outline-2 focus-visible:outline-offset-2",
                            cellClasses(cell.state, isSelected),
                          )}
                        >
                          {label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Fade + chevron on the scrollable edge — supporting visual cue
            for the text hint above, not a substitute for it (a purely
            visual affordance is exactly what was missed before: the
            grid already cut off mid-word with nothing signalling more
            content, and a sighted user could still miss a subtle edge
            fade the same way). pointer-events-none so it never blocks
            taps on the last visible column; hidden once scrolled to the
            end since it's done its job by then. */}
        {hasOverflow && !isAtEnd ? (
          <div
            aria-hidden="true"
            className="from-navy-800 pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-end bg-gradient-to-l to-transparent pr-1.5"
          >
            <span className="text-bone text-lg leading-none">›</span>
          </div>
        ) : null}
      </div>

      <div className="font-jetbrains text-slate flex flex-wrap gap-5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-white" aria-hidden="true" />
          Open — tap to hold
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-sky-400" aria-hidden="true" />
          Already booked
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-emerald-700" aria-hidden="true" />
          Open play — walk in
        </span>
      </div>

      <div
        role="status"
        aria-live="polite"
        className={cn(
          "bg-navy-700 border-green/45 fixed bottom-5 left-1/2 z-50 flex w-[min(620px,calc(100%-32px))] -translate-x-1/2 flex-wrap items-center gap-4 rounded-2xl border px-4 py-3.5 shadow-[0_20px_50px_rgba(0,0,0,.55)] transition-transform duration-300",
          isTrayUp ? "translate-y-0" : "translate-y-[140%]",
        )}
      >
        <div className="min-w-[180px] flex-1">
          <b className="font-display text-bone block text-xl font-extrabold tracking-[0.02em]">
            {selectedHours.length} {selectedHours.length === 1 ? "hour" : "hours"} held ·{" "}
            {formatCurrency(total)}
          </b>
          <span className="font-jetbrains text-slate mt-0.5 block text-[11px]">
            {selectedHours.length > 0 ? `${dateLabel} · from ${hourLabel(selectedHours[0])}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClear}
          className="font-jetbrains text-slate hover:text-bone text-[11px] underline"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleReserve}
          className="bg-green text-navy-900 focus-visible:outline-green rounded-full px-5 py-2.5 text-sm font-bold transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Reserve
        </button>
      </div>
    </div>
  );
}
