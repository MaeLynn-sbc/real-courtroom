import Link from "next/link";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { getCourtBookingWindow } from "@/lib/court-hours";
import { cn, formatCurrency } from "@/lib/utils";
import { bookingService } from "@/services/booking/booking.service";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

const GRID_START_HOUR = 7; // 7:00 AM
const GRID_END_HOUR = 24; // slots run up to, but not including, 12:00 AM

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });
const dateHeadingFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeValue(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function overlapsAny(slotStart: Date, slotEnd: Date, ranges: { startAt: Date; endAt: Date }[]): boolean {
  return ranges.some((range) => slotStart < range.endAt && slotEnd > range.startAt);
}

type CellState = "unavailable" | "openPlay" | "past" | "booked" | "available";

export async function CourtAvailabilityGrid({ date }: { date: Date }) {
  const [courts, schedule, courtHours] = await Promise.all([
    courtService.listCourts(),
    bookingService.getPublicDaySchedule(date),
    settingsService.getCourtHours(),
  ]);

  const activeCourts = courts.filter((court) => court.status === "ACTIVE");
  const scheduleByCourtId = new Map(schedule.map((entry) => [entry.courtId, entry]));

  const dateValue = toLocalDateValue(date);
  const previousDateValue = toLocalDateValue(addDays(date, -1));
  const nextDateValue = toLocalDateValue(addDays(date, 1));
  const now = Date.now();

  const hours = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR },
    (_, index) => GRID_START_HOUR + index,
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight">Court Availability</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {dateHeadingFormatter.format(date)} · ₱350/hr · pay at the venue
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/?date=${previousDateValue}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            ‹ Prev
          </Link>
          <form className="flex items-center gap-2">
            <input
              type="date"
              name="date"
              defaultValue={dateValue}
              className="border-input h-9 rounded-lg border px-3 text-sm"
            />
            <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
              View
            </button>
          </form>
          <Link href={`/?date=${nextDateValue}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next ›
          </Link>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            {activeCourts.map((court) => (
              <TableHead key={court.id}>{court.name}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {hours.map((hour) => {
            const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0);
            const slotEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1, 0);

            return (
              <TableRow key={hour}>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {timeFormatter.format(slotStart)} – {timeFormatter.format(slotEnd)}
                </TableCell>
                {activeCourts.map((court) => {
                  const courtSchedule = scheduleByCourtId.get(court.id);
                  const window = getCourtBookingWindow(courtHours, court.name, date);

                  let state: CellState;
                  if (overlapsAny(slotStart, slotEnd, courtSchedule?.maintenanceRanges ?? [])) {
                    state = "unavailable";
                  } else if (hour * 60 < window.openMinutes || (hour + 1) * 60 > window.closeMinutes) {
                    state = "openPlay";
                  } else if (slotStart.getTime() <= now) {
                    state = "past";
                  } else if (overlapsAny(slotStart, slotEnd, courtSchedule?.bookedRanges ?? [])) {
                    state = "booked";
                  } else {
                    state = "available";
                  }

                  if (state === "available") {
                    return (
                      <TableCell key={court.id} className="p-1.5">
                        <Link
                          href={`/book?courtId=${court.id}&date=${dateValue}&time=${toTimeValue(hour)}`}
                          className="text-success hover:bg-success/10 border-success/30 block rounded-lg border px-2 py-1.5 text-center text-xs font-medium transition-colors"
                        >
                          {formatCurrency(court.hourlyRateCents ?? 0)}
                        </Link>
                      </TableCell>
                    );
                  }

                  return (
                    <TableCell key={court.id} className="p-1.5">
                      <div
                        className={cn(
                          "text-muted-foreground rounded-lg px-2 py-1.5 text-center text-xs",
                          state === "openPlay" && "bg-warning/10 text-warning-foreground",
                          (state === "unavailable" || state === "booked") && "bg-muted",
                          state === "past" && "bg-muted/50",
                        )}
                      >
                        {state === "openPlay"
                          ? "Open Play"
                          : state === "unavailable"
                            ? "Unavailable"
                            : state === "past"
                              ? "—"
                              : "Booked"}
                      </div>
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
