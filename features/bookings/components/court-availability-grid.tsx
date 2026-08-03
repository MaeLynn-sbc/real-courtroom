import Link from "next/link";

import {
  AvailabilityBoard,
  type BoardCell,
  type BoardCourt,
} from "@/features/bookings/components/availability-board";
import { classifyCourtSlot, getCourtBookingWindow } from "@/lib/court-hours";
import { cn } from "@/lib/utils";
import { bookingService } from "@/services/booking/booking.service";
import { generateHomeScheduleQrCode } from "@/services/booking/qr-code";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

const GRID_START_HOUR = 7; // 7:00 AM
const GRID_END_HOUR = 24; // slots run up to, but not including, 12:00 AM
const DAY_PICKER_LENGTH = 7; // BUILD-SPEC.md §3: "7-day date picker, today first"

const dateHeadingFormatter = new Intl.DateTimeFormat("en-PH", {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-PH", { weekday: "short" });

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Data fetching still lives here — this file owns every Prisma-backed
// read. Per-hour STATE classification is now lib/court-hours.ts's
// classifyCourtSlot (extracted after a real bug: the inline version
// checked "past" before "booked," so an elapsed hour inside a real
// booking showed as generically "Past" instead of "Booked" — see that
// function's own comment). Extracted rather than just reordered so the
// precedence has a real, unit-tested home instead of being an easy-to-
// re-break inline if/else chain.
export async function CourtAvailabilityGrid({
  date,
  basePath = "/",
}: {
  date: Date;
  basePath?: string;
}) {
  const [courts, schedule, courtHours, scheduleQrCode] = await Promise.all([
    courtService.listCourts(),
    bookingService.getPublicDaySchedule(date),
    settingsService.getCourtHours(),
    generateHomeScheduleQrCode(),
  ]);

  const activeCourts = courts.filter((court) => court.status === "ACTIVE");
  const scheduleByCourtId = new Map(schedule.map((entry) => [entry.courtId, entry]));

  const dateValue = toLocalDateValue(date);
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayOptions = Array.from({ length: DAY_PICKER_LENGTH }, (_, index) => addDays(today, index));

  const hours = Array.from(
    { length: GRID_END_HOUR - GRID_START_HOUR },
    (_, index) => GRID_START_HOUR + index,
  );

  const boardCourts: BoardCourt[] = activeCourts.map((court) => ({
    id: court.id,
    name: court.name,
    priceCents: court.hourlyRateCents,
  }));

  const cells: Record<string, BoardCell> = {};
  for (const hour of hours) {
    const slotStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, 0);
    const slotEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour + 1, 0);

    for (const court of activeCourts) {
      const courtSchedule = scheduleByCourtId.get(court.id);
      const window = getCourtBookingWindow(courtHours, court.name, date);

      const state = classifyCourtSlot({
        hour,
        slotStart,
        slotEnd,
        now,
        window,
        maintenanceRanges: courtSchedule?.maintenanceRanges ?? [],
        bookedRanges: courtSchedule?.bookedRanges ?? [],
      });

      cells[`${hour}:${court.id}`] = { state };
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
            The docket
          </span>
          <h2 className="font-display text-bone mt-1 text-[clamp(30px,4.4vw,44px)] leading-[0.94] font-extrabold tracking-[-0.01em] uppercase">
            Today&apos;s open slots
          </h2>
        </div>
        <p className="text-slate max-w-[46ch] text-sm">
          Tap any open slot to book it. Courts run {dateHeadingFormatter.format(date)}. Once a court
          switches to open play you don&apos;t book it — just walk in.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        {/* LEFT: Book Now + QR sidebar, in this same section so it's
            visible right alongside the grid, not buried elsewhere on the
            page (the hero above already has its own "Book Now" CTA —
            this one is scoped to the docket for someone already looking
            at the schedule). lg:sticky keeps it in view while a tall
            grid scrolls on desktop; stacks above the grid on mobile. */}
        <div className="border-line bg-navy-800 flex flex-col items-center gap-4 self-start rounded-2xl border p-5 text-center lg:sticky lg:top-24">
          <Link
            href="/book"
            className="bg-green text-navy-900 focus-visible:outline-green inline-flex w-full items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-bold tracking-[0.04em] uppercase transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Book Now
          </Link>
          <div className="bg-bone rounded-xl p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image */}
            <img
              src={scheduleQrCode}
              alt="QR code linking to this live schedule"
              width={140}
              height={140}
            />
          </div>
          <p className="text-slate text-[11px] leading-snug">
            Scan to open this live schedule on your phone.
          </p>
        </div>

        {/* RIGHT: date picker + grid */}
        <div className="flex flex-col gap-4">
          <div
            role="group"
            aria-label="Choose a date"
            className="flex [scrollbar-width:none] gap-2 overflow-x-auto pb-1.5 [&::-webkit-scrollbar]:hidden"
          >
            {dayOptions.map((day, index) => {
              const value = toLocalDateValue(day);
              const isActive = value === dateValue;
              return (
                <Link
                  key={value}
                  href={`${basePath}?date=${value}`}
                  aria-pressed={isActive}
                  className={cn(
                    "border-line bg-navy-800 hover:border-green/60 flex min-w-[70px] shrink-0 flex-col items-center gap-0.5 rounded-xl border px-3.5 py-2.5 text-center transition-colors",
                    isActive && "bg-green border-green hover:border-green",
                  )}
                >
                  <small
                    className={cn(
                      "font-jetbrains text-[10px] tracking-[0.14em] uppercase",
                      isActive ? "text-navy-900/70" : "text-slate",
                    )}
                  >
                    {index === 0 ? "Today" : weekdayFormatter.format(day)}
                  </small>
                  <b
                    className={cn(
                      "font-display text-[22px] leading-[1.15] font-extrabold",
                      isActive && "text-navy-900",
                    )}
                  >
                    {day.getDate()}
                  </b>
                </Link>
              );
            })}
          </div>

          <AvailabilityBoard
            courts={boardCourts}
            hours={hours}
            cells={cells}
            dateValue={dateValue}
          />
        </div>
      </div>
    </div>
  );
}
