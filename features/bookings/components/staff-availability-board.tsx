import Link from "next/link";

import { cn } from "@/lib/utils";

export interface StaffBoardCourt {
  id: string;
  name: string;
}

export type StaffBoardCellState =
  | "available"
  | "booked"
  | "bookedCoach"
  | "openPlay"
  | "past"
  | "unavailable";

export interface StaffBoardCell {
  state: StaffBoardCellState;
  bookingId?: string;
  customerName?: string;
  coachName?: string;
}

interface StaffAvailabilityBoardProps {
  courts: StaffBoardCourt[];
  hours: number[];
  cells: Record<string, StaffBoardCell>;
}

function hourLabel(hour: number): string {
  const period = hour < 12 ? "AM" : "PM";
  const twelveHour = ((hour + 11) % 12) + 1;
  return `${twelveHour}:00 ${period}`;
}

// Owner request (2026-08-05): "i want the colors same as public view if
// possible." Same color/typography system as the public homepage grid
// (features/bookings/components/availability-board.tsx) — navy-900/800/
// 700, bone/slate/line, font-jetbrains/font-display, the same five state
// colors (white/sky-400/rose-300/emerald-700/dim) — just with the real
// customer name (and coach name) a staff member is allowed to see,
// which the public grid never shows. Deliberately a separate component,
// not the public one reused with an extra prop — see
// booking.service.ts's getStaffDaySchedule for why the data underneath
// stays separate too (a customer name must never be able to leak onto
// the public site through a shared code path).
function cellClasses(state: StaffBoardCellState): string {
  switch (state) {
    case "available":
      return "bg-white text-gray-600 border-white font-bold uppercase tracking-[0.04em] after:bg-green after:opacity-70";
    case "openPlay":
      return "bg-emerald-700 border-emerald-500 text-white text-[12px] font-bold tracking-[0.1em] uppercase after:bg-emerald-300 after:opacity-70";
    case "past":
      return "bg-navy-700/25 border-transparent text-slate/40 after:bg-slate after:opacity-10";
    case "booked":
      return "bg-sky-400 border-sky-500 text-navy-900 font-bold after:bg-sky-600 after:opacity-70";
    case "bookedCoach":
      return "bg-rose-300 border-rose-400 text-navy-900 font-bold after:bg-rose-500 after:opacity-70";
    case "unavailable":
    default:
      return "bg-navy-700/40 border-transparent text-slate/50 after:bg-slate after:opacity-20";
  }
}

function cellLabel(state: StaffBoardCellState): string {
  switch (state) {
    case "available":
      return "Available";
    case "openPlay":
      return "Open play";
    case "past":
      return "Past";
    case "unavailable":
      return "Unavailable";
    case "booked":
    case "bookedCoach":
    default:
      return "Booked";
  }
}

export function StaffAvailabilityBoard({ courts, hours, cells }: StaffAvailabilityBoardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-line bg-navy-800 overflow-hidden rounded-2xl border">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-navy-700 border-line text-slate font-jetbrains border-b px-4 py-3 text-left text-[11px] font-normal tracking-[0.16em] uppercase"
                >
                  Time
                </th>
                {courts.map((court) => (
                  <th
                    key={court.id}
                    scope="col"
                    className="bg-navy-700 border-line font-display text-bone border-b px-2 py-3 text-center text-[16px] font-extrabold tracking-[0.06em] uppercase"
                  >
                    {court.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour} className="border-line border-t">
                  <td className="bg-navy-700 font-jetbrains text-bone w-28 px-4 py-1.5 text-sm font-medium whitespace-nowrap sm:w-32">
                    {hourLabel(hour)}
                  </td>
                  {courts.map((court) => {
                    const cell = cells[`${hour}:${court.id}`];
                    const label = cellLabel(cell.state);
                    const isBookedish = cell.state === "booked" || cell.state === "bookedCoach";

                    const content = (
                      <div
                        className={cn(
                          "font-jetbrains relative flex min-h-[46px] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg border px-1 text-[13px] font-medium",
                          "after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:content-['']",
                          isBookedish && "hover:opacity-90",
                          cellClasses(cell.state),
                        )}
                      >
                        {label}
                        {isBookedish && cell.customerName ? (
                          <span className="max-w-full truncate text-[10px] font-bold tracking-[0.02em] opacity-90">
                            {cell.customerName}
                          </span>
                        ) : null}
                        {cell.state === "bookedCoach" && cell.coachName ? (
                          <span className="text-[9px] font-bold tracking-[0.08em] uppercase opacity-80">
                            Coach: {cell.coachName}
                          </span>
                        ) : null}
                      </div>
                    );

                    return (
                      <td key={court.id} className="p-1.5">
                        {isBookedish && cell.bookingId ? (
                          <Link
                            href={`/dashboard/bookings/${cell.bookingId}`}
                            aria-label={`Court ${court.name}, ${hourLabel(hour)}, booked by ${cell.customerName ?? "guest"}${
                              cell.coachName ? `, coach: ${cell.coachName}` : ""
                            } — view booking`}
                          >
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
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
          <i className="inline-block size-3.5 rounded bg-white" aria-hidden="true" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-sky-400" aria-hidden="true" />
          Booked
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-rose-300" aria-hidden="true" />
          Booked with a coach
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3.5 rounded bg-emerald-700" aria-hidden="true" />
          Open play
        </span>
      </div>
    </div>
  );
}
