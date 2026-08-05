import type { Metadata } from "next";
import Link from "next/link";

import {
  StaffAvailabilityBoard,
  type StaffBoardCell,
} from "@/features/bookings/components/staff-availability-board";
import { classifyCourtSlot, getCourtBookingWindow } from "@/lib/court-hours";
import { bookingService } from "@/services/booking/booking.service";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Bookings — Grid",
};

// Same reason as every other date-scoped dashboard page — a booking
// made moments ago must show up immediately.
export const dynamic = "force-dynamic";

const GRID_START_HOUR = 7; // 7:00 AM
const GRID_END_HOUR = 24; // slots run up to, but not including, 12:00 AM

const dateHeadingFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
});

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

interface BookingsGridPageProps {
  searchParams: Promise<{ date?: string }>;
}

// Owner request (2026-08-05): "a grid view in the staff side so that it
// would be easy for us to check if there's avail slot and put a name of
// the person who booked and the coach as well." Same court-hours
// classification the public homepage grid uses (classifyCourtSlot),
// fed by bookingService.getStaffDaySchedule instead of the public,
// name-free getPublicDaySchedule — see that method's own comment for
// why it's a separate query, not a "staff mode" flag on the public one.
export default async function BookingsGridPage({ searchParams }: BookingsGridPageProps) {
  const { date: dateParam } = await searchParams;
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  const [courts, schedule, courtHours] = await Promise.all([
    courtService.listCourts(),
    bookingService.getStaffDaySchedule(date),
    settingsService.getCourtHours(),
  ]);

  const activeCourts = courts.filter((court) => court.status === "ACTIVE");
  const scheduleByCourtId = new Map(schedule.map((entry) => [entry.courtId, entry]));

  const now = Date.now();
  const hours = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR },
    (_, index) => GRID_START_HOUR + index,
  );

  const cells: Record<string, StaffBoardCell> = {};
  for (const hour of hours) {
    const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0);
    const slotEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1, 0);

    for (const court of activeCourts) {
      const courtSchedule = scheduleByCourtId.get(court.id);
      const window = getCourtBookingWindow(courtHours, court.name, date);
      const bookedRanges = courtSchedule?.bookedRanges ?? [];

      const state = classifyCourtSlot({
        hour,
        slotStart,
        slotEnd,
        now,
        window,
        maintenanceRanges: courtSchedule?.maintenanceRanges ?? [],
        bookedRanges,
      });

      if (state === "booked" || state === "bookedCoach") {
        const overlapping = bookedRanges.find(
          (range) => slotStart < range.endAt && slotEnd > range.startAt,
        );
        cells[`${hour}:${court.id}`] = {
          state,
          bookingId: overlapping?.bookingId,
          customerName: overlapping?.customerName,
          coachName: overlapping?.coachName,
        };
      } else {
        cells[`${hour}:${court.id}`] = { state };
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings — Grid</h1>
          <p className="text-muted-foreground text-sm">
            {dateHeadingFormatter.format(date)} — hover a booked slot to see who, tap it to open
            the booking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/dashboard/bookings/grid?date=${toDateValue(addDays(date, -1))}`}
            className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
          >
            ← Prev day
          </Link>
          {/* Zero-client-JS date jump, same GET-form pattern already
              established for the reconciliation page's Archive tab. */}
          <form className="flex items-center gap-2">
            <input
              type="date"
              name="date"
              defaultValue={toDateValue(date)}
              className="border-input bg-background rounded-md border px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
            >
              Go
            </button>
          </form>
          <Link
            href={`/dashboard/bookings/grid?date=${toDateValue(addDays(date, 1))}`}
            className="border-input hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
          >
            Next day →
          </Link>
        </div>
      </div>

      {activeCourts.length === 0 ? (
        <p className="text-muted-foreground text-sm">No active courts to show.</p>
      ) : (
        <StaffAvailabilityBoard courts={activeCourts} hours={hours} cells={cells} />
      )}
    </div>
  );
}
