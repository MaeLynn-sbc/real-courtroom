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

// Owner request (2026-08-05): "put a name of the person who booked and
// the coach as well" — this is the STAFF-only twin of the public
// homepage grid (features/bookings/components/availability-board.tsx),
// same layout/state model, but shows the real customer name (and coach
// name) a staff member is allowed to see and the public never is. Light/
// dashboard-styled (bg-card, standard shadcn tokens), not the public
// site's bespoke dark navy/green branding — this lives under
// /dashboard, where every other page already uses that palette.
function cellClasses(state: StaffBoardCellState): string {
  switch (state) {
    case "available":
      return "bg-background border-input";
    case "booked":
      return "bg-court-blue/15 border-court-blue text-court-blue";
    case "bookedCoach":
      return "bg-rose-100 border-rose-300 text-rose-900 dark:bg-rose-950/40 dark:border-rose-800 dark:text-rose-200";
    case "openPlay":
      return "bg-success/15 border-success text-success";
    case "past":
      return "bg-muted/40 border-transparent text-muted-foreground opacity-60";
    case "unavailable":
    default:
      return "bg-muted/60 border-transparent text-muted-foreground";
  }
}

function cellLabel(state: StaffBoardCellState): string {
  switch (state) {
    case "available":
      return "Available";
    case "booked":
    case "bookedCoach":
      return "Booked";
    case "openPlay":
      return "Open Play";
    case "past":
      return "Past";
    case "unavailable":
    default:
      return "Unavailable";
  }
}

export function StaffAvailabilityBoard({ courts, hours, cells }: StaffAvailabilityBoardProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/40">
              <th className="text-muted-foreground w-24 border-b px-3 py-2 text-left text-xs font-medium">
                Time
              </th>
              {courts.map((court) => (
                <th
                  key={court.id}
                  className="border-b px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide"
                >
                  {court.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hours.map((hour) => (
              <tr key={hour} className="border-t">
                <td className="text-muted-foreground bg-muted/20 px-3 py-1.5 text-xs font-medium whitespace-nowrap">
                  {hourLabel(hour)}
                </td>
                {courts.map((court) => {
                  const cell = cells[`${hour}:${court.id}`];
                  const isBookedish = cell.state === "booked" || cell.state === "bookedCoach";

                  const content = (
                    <div
                      className={cn(
                        "flex min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-lg border px-1.5 py-1 text-center text-xs",
                        cellClasses(cell.state),
                        isBookedish && "hover:opacity-80",
                      )}
                    >
                      <span className="font-semibold">{cellLabel(cell.state)}</span>
                      {isBookedish && cell.customerName ? (
                        <span className="max-w-full truncate text-[11px] font-medium">
                          {cell.customerName}
                        </span>
                      ) : null}
                      {cell.state === "bookedCoach" && cell.coachName ? (
                        <span className="max-w-full truncate text-[10px] opacity-80">
                          Coach: {cell.coachName}
                        </span>
                      ) : null}
                    </div>
                  );

                  return (
                    <td key={court.id} className="p-1">
                      {isBookedish && cell.bookingId ? (
                        <Link
                          href={`/dashboard/bookings/${cell.bookingId}`}
                          aria-label={`${court.name}, ${hourLabel(hour)}, booked by ${cell.customerName ?? "guest"}${
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

      <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <i className="bg-background border-input inline-block size-3 rounded border" aria-hidden="true" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-court-blue/15 border-court-blue inline-block size-3 rounded border" aria-hidden="true" />
          Booked
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block size-3 rounded border border-rose-300 bg-rose-100" aria-hidden="true" />
          Booked with a coach
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-success/15 border-success inline-block size-3 rounded border" aria-hidden="true" />
          Open Play
        </span>
        <span className="flex items-center gap-1.5">
          <i className="bg-muted/60 inline-block size-3 rounded border border-transparent" aria-hidden="true" />
          Unavailable / Past
        </span>
      </div>
    </div>
  );
}
