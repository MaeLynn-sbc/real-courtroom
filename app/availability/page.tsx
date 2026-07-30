import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Court Availability",
  description: "Live court schedule — see what's available today.",
};

export const dynamic = "force-dynamic";

interface AvailabilityPageProps {
  searchParams: Promise<{ date?: string }>;
}

const timeFormatter = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", hour12: true });

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default async function AvailabilityPage({ searchParams }: AvailabilityPageProps) {
  const { date: dateParam } = await searchParams;
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();
  const dateValue = toLocalDateValue(date);

  const schedule = await bookingService.getPublicDaySchedule(date);

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-16">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-heading text-4xl font-semibold tracking-tight">Court Availability</h1>
            <p className="text-muted-foreground mt-2 text-lg">Live schedule, updated in real time.</p>
          </div>
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
        </div>

        <div className="flex flex-col gap-4">
          {schedule.map((court) => (
            <div key={court.courtId} className="rounded-xl border p-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-heading font-semibold">{court.courtName}</p>
                {court.status !== "ACTIVE" ? (
                  <span className="text-destructive text-xs font-medium">
                    {court.status === "MAINTENANCE" ? "Under maintenance" : "Unavailable"}
                  </span>
                ) : null}
              </div>
              {court.status === "ACTIVE" ? (
                court.bookedRanges.length === 0 && court.maintenanceRanges.length === 0 ? (
                  <p className="text-success text-sm">Open all day</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {court.bookedRanges.map((range, index) => (
                      <li key={`booked-${index}`} className="text-muted-foreground">
                        {timeFormatter.format(range.startAt)} – {timeFormatter.format(range.endAt)} · Booked
                      </li>
                    ))}
                    {court.maintenanceRanges.map((range, index) => (
                      <li key={`maintenance-${index}`} className="text-muted-foreground">
                        {timeFormatter.format(range.startAt)} – {timeFormatter.format(range.endAt)} ·
                        Unavailable (maintenance)
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </div>
          ))}
        </div>

        <Link href="/book" className={buttonVariants({ size: "lg" })}>
          Book Now
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
