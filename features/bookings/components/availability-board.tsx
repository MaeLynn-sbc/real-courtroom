"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";

export interface BoardCourt {
  id: string;
  name: string;
  priceCents: number | null;
}

export interface BoardCell {
  state: "unavailable" | "openPlay" | "past" | "booked" | "bookedCoach" | "available";
}

interface AvailabilityBoardProps {
  courts: BoardCourt[];
  hours: number[];
  cells: Record<string, BoardCell>;
  dateValue: string;
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
// mirrors docs/design-reference.html's .slot styling. Five states read
// as five genuinely distinct color families, not shades of one hue:
//   - available (open, tap to book): solid white fill, dark gray text
//     (owner request, 2026-08-02 — was bone/navy-900), label in caps —
//     comfortably clears WCAG AA's 4.5:1 for normal text.
//   - booked: solid sky-400 (Tailwind, not a custom brand token — same
//     precedent as the dashboard's RecordCard ramps using stock
//     Tailwind shades for functional/state color, not brand identity),
//     navy-900 text. Was a ~15%-opacity tint that read as too faint/
//     transparent to the owner live; solid fill fixes that — 8.57:1
//     contrast.
//   - booked, with a coach (owner request, 2026-08-02): a VARIANT of
//     booked, not an independent state — same weight (light fill, dark
//     navy-900 text), rose-300 instead of sky-400, so it reads as "a
//     kind of Booked" rather than a whole different category the way
//     open play's solid dark fill does. Rose over plum (the other
//     option considered): plum sits nearer sky-blue on the color wheel
//     and separates poorly at grid density in daylight on a phone.
//     Colour is never the only signal — see the "Coach" sub-label in
//     the render below and this cell's aria-label — a colourblind user
//     or a washed-out phone screen must still be able to tell the two
//     apart.
//   - open play (walk-in, not booked through this grid): solid
//     emerald-700, white text — deliberately a DIFFERENT green from
//     the brand --green used by the Available stripe accent below, so
//     an open-play cell is never mistaken for a bookable one.
//     5.48:1 contrast.
//   - past / unavailable (maintenance): neutral/muted, deliberately not
//     part of the color system — not bookable states competing for
//     attention, just dimmed out.
function cellClasses(state: BoardCell["state"]): string {
  switch (state) {
    case "available":
      return "bg-white text-gray-600 border-white font-bold uppercase tracking-[0.04em] hover:-translate-y-px after:bg-green after:opacity-70 cursor-pointer";
    case "openPlay":
      return "bg-emerald-700 border-emerald-500 text-white text-[12px] font-bold tracking-[0.1em] uppercase after:bg-emerald-300 after:opacity-70 cursor-default";
    case "past":
      return "bg-navy-700/25 border-transparent text-slate/40 cursor-not-allowed after:bg-slate after:opacity-10";
    case "booked":
      return "bg-sky-400 border-sky-500 text-navy-900 font-bold cursor-not-allowed after:bg-sky-600 after:opacity-70";
    case "bookedCoach":
      return "bg-rose-300 border-rose-400 text-navy-900 font-bold cursor-not-allowed after:bg-rose-500 after:opacity-70";
    default:
      // unavailable (maintenance)
      return "bg-navy-700/40 border-transparent text-slate/50 cursor-not-allowed after:bg-slate after:opacity-20";
  }
}

function cellLabel(state: BoardCell["state"]): string {
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
    case "bookedCoach":
    default:
      return "Booked";
  }
}

export function AvailabilityBoard({ courts, hours, cells, dateValue }: AvailabilityBoardProps) {
  const router = useRouter();
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

  // One click, straight to /book with a 1-hour slot pre-filled — no
  // intermediate "hold this slot, now confirm" step. Duration is still
  // freely editable once the customer lands on the booking form (which
  // already supports a durationMinutes query param), so nothing about
  // multi-hour bookings is lost, just the extra tap.
  function handleCellClick(courtId: string, hour: number) {
    router.push(
      `/book?courtId=${courtId}&date=${dateValue}&time=${toTimeValue(hour)}&durationMinutes=60`,
    );
  }

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
                    const label = cellLabel(cell.state);

                    if (cell.state !== "available") {
                      const isBookedCoach = cell.state === "bookedCoach";
                      return (
                        <td key={court.id} className="p-1.5">
                          <div
                            className={cn(
                              "font-jetbrains relative flex min-h-[46px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border text-[13px] font-medium",
                              "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                              cellClasses(cell.state),
                            )}
                            aria-label={`Court ${court.name}, ${hourLabel(hour)}, ${
                              isBookedCoach ? "booked, coach expected" : label.toLowerCase()
                            }`}
                          >
                            {label}
                            {/* Colour is never the only signal (a colourblind
                                visitor, or the grid washed out in daylight on a
                                phone, must still be able to tell this apart from
                                a plain Booked cell) — a small text badge, not an
                                icon, matching every other state in this grid
                                being text-only. */}
                            {isBookedCoach ? (
                              <span className="text-[9px] font-bold tracking-[0.08em] uppercase opacity-80">
                                Coach
                              </span>
                            ) : null}
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={court.id} className="p-1.5">
                        <button
                          type="button"
                          onClick={() => handleCellClick(court.id, hour)}
                          aria-label={`Court ${court.name}, ${hourLabel(hour)}, available — tap to book`}
                          className={cn(
                            "font-jetbrains relative flex min-h-[46px] w-full items-center justify-center overflow-hidden rounded-lg border text-[13px] font-medium transition-all",
                            "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                            "focus-visible:outline-green focus-visible:outline-2 focus-visible:outline-offset-2",
                            cellClasses(cell.state),
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
          Open — tap to book
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-sky-400" aria-hidden="true" />
          Already booked
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-rose-300" aria-hidden="true" />
          Booked with a coach
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-emerald-700" aria-hidden="true" />
          Open play — walk in
        </span>
      </div>
    </div>
  );
}
