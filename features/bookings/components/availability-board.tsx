"use client";

import { useMemo, useState } from "react";
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

// One slot renders as a miniature court: navy fill, coral non-volley-zone
// stripe along the bottom edge — mirrors docs/design-reference.html's
// .slot styling, translated to Tailwind utilities.
function cellClasses(state: BoardCell["state"], isSelected: boolean): string {
  if (isSelected) {
    return "bg-green text-navy-900 border-green font-bold after:bg-navy-900/30";
  }
  switch (state) {
    case "available":
      return "bg-navy-600 text-bone/55 border-transparent hover:bg-navy-700 hover:border-green hover:text-bone hover:-translate-y-px after:bg-coral after:opacity-75 cursor-pointer";
    case "openPlay":
      return "bg-coral/[0.13] border-coral/30 text-coral text-[10px] font-bold tracking-[0.1em] uppercase after:bg-coral after:opacity-60 cursor-default";
    case "past":
      return "bg-navy-700/25 border-transparent text-slate/40 cursor-not-allowed after:bg-slate after:opacity-10";
    default:
      // unavailable, booked
      return "bg-navy-700/40 border-transparent text-slate/50 cursor-not-allowed after:bg-slate after:opacity-20";
  }
}

function cellLabel(state: BoardCell["state"], priceCents: number | null, isSelected: boolean): string {
  if (isSelected) {
    return "Held";
  }
  switch (state) {
    case "available":
      return formatCurrency(priceCents ?? 0);
    case "openPlay":
      return "Open play";
    case "past":
      return "—";
    case "unavailable":
      return "Unavailable";
    default:
      return "Booked";
  }
}

export function AvailabilityBoard({ courts, hours, cells, dateValue, dateLabel }: AvailabilityBoardProps) {
  const router = useRouter();
  const [selection, setSelection] = useState<Selection | null>(null);

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
    router.push(`/book?courtId=${selection.courtId}&date=${dateValue}&time=${time}&durationMinutes=${durationMinutes}`);
  }

  const selectedCourt = selection ? courts.find((court) => court.id === selection.courtId) : undefined;
  const total = selectedCourt ? (selectedCourt.priceCents ?? 0) * selectedHours.length : 0;
  const isTrayUp = selectedHours.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="border-line bg-navy-800 overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-navy-700 border-line text-slate font-jetbrains sticky top-16 z-10 border-b px-4 py-3 text-left text-[10px] font-normal tracking-[0.16em] uppercase"
                >
                  Time
                </th>
                {courts.map((court) => (
                  <th
                    key={court.id}
                    scope="col"
                    className="bg-navy-700 border-line font-display text-bone sticky top-16 z-10 border-b px-2 py-3 text-center text-[15px] font-extrabold tracking-[0.06em] uppercase"
                  >
                    {court.name}
                    <small className="font-jetbrains text-slate mt-0.5 block text-[9.5px] font-normal tracking-[0.16em] normal-case">
                      Indoor
                    </small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour} className="border-line border-t">
                  <td className="bg-navy-700 font-jetbrains text-bone w-28 px-4 py-1.5 text-xs font-medium whitespace-nowrap sm:w-32">
                    {hourLabel(hour)}
                  </td>
                  {courts.map((court) => {
                    const cell = cells[`${hour}:${court.id}`];
                    const isSelected = selection?.courtId === court.id && selection.hours.includes(hour);
                    const label = cellLabel(cell.state, court.priceCents, isSelected);

                    if (cell.state !== "available" && !isSelected) {
                      return (
                        <td key={court.id} className="p-1.5">
                          <div
                            className={cn(
                              "font-jetbrains relative flex min-h-[46px] items-center justify-center overflow-hidden rounded-lg border text-[11px] font-medium",
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
                            isSelected ? "held, tap to release" : `available, ${formatCurrency(court.priceCents ?? 0)}`
                          }`}
                          className={cn(
                            "font-jetbrains relative flex min-h-[46px] w-full items-center justify-center overflow-hidden rounded-lg border text-[11px] font-medium transition-all",
                            "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green",
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
      </div>

      <div className="font-jetbrains text-slate flex flex-wrap gap-5 text-[11px]">
        <span className="flex items-center gap-1.5">
          <i className="bg-navy-600 inline-block size-3.5 rounded" aria-hidden="true" />
          Open — tap to hold
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-navy-700/70 border-line inline-block size-3.5 rounded border" aria-hidden="true" />
          Already booked
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-coral/30 inline-block size-3.5 rounded" aria-hidden="true" />
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
            {selectedHours.length} {selectedHours.length === 1 ? "hour" : "hours"} held · {formatCurrency(total)}
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
          className="bg-green text-navy-900 rounded-full px-5 py-2.5 text-sm font-bold transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          Reserve
        </button>
      </div>
    </div>
  );
}
