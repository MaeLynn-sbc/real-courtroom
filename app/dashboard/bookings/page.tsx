import { PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { BookingList } from "@/features/bookings/components/booking-list";
import type { BookingSource, BookingStatus } from "@/lib/generated/prisma/enums";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Bookings",
};

const STATUS_FILTER_OPTIONS: { value: BookingStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "CHECKED_IN", label: "Checked In" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "NO_SHOW", label: "No Show" },
  // Reported live: the payment states had no way to filter for at all —
  // "pull up everything awaiting verification, or everything unpaid, for
  // a given date" was unreachable from this dropdown.
  { value: "AWAITING_PAYMENT", label: "Awaiting Payment" },
  { value: "PENDING_VERIFICATION", label: "Pending Verification" },
  { value: "REJECTED", label: "Rejected" },
  { value: "REFUNDED", label: "Refunded" },
];

const SOURCE_FILTER_OPTIONS: { value: BookingSource; label: string }[] = [
  { value: "PUBLIC", label: "Public" },
  { value: "STAFF", label: "Staff" },
  { value: "UNKNOWN", label: "Unknown" },
];

const SORT_OPTIONS = [
  { value: "startAt", label: "Reservation time" },
  { value: "createdAt", label: "When it came in" },
] as const;

interface BookingsPageProps {
  searchParams: Promise<{ date?: string; status?: string; source?: string; sort?: string }>;
}

function todayInputValue(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export default async function BookingsPage({ searchParams }: BookingsPageProps) {
  const {
    date: dateParam,
    status: statusParam,
    source: sourceParam,
    sort: sortParam,
  } = await searchParams;
  const dateValue = dateParam ?? todayInputValue();
  const statusValue = STATUS_FILTER_OPTIONS.some((option) => option.value === statusParam)
    ? (statusParam as BookingStatus)
    : undefined;
  const sourceValue = SOURCE_FILTER_OPTIONS.some((option) => option.value === sourceParam)
    ? (sourceParam as BookingSource)
    : undefined;
  const sortValue = sortParam === "createdAt" ? "createdAt" : "startAt";

  const bookings = await bookingService.listBookings({
    date: new Date(`${dateValue}T00:00:00`),
    status: statusValue,
    source: sourceValue,
    sortBy: sortValue,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
          <p className="text-muted-foreground text-sm">
            Manage court bookings, walk-ins, and check-ins.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/bookings/check-in"
            className={buttonVariants({ variant: "outline" })}
          >
            Check in
          </Link>
          <Link href="/dashboard/bookings/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New booking
          </Link>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="date" className="text-sm font-medium">
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            defaultValue={dateValue}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={statusValue ?? ""}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            <option value="">All</option>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="source" className="text-sm font-medium">
            Source
          </label>
          <select
            id="source"
            name="source"
            defaultValue={sourceValue ?? ""}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            <option value="">All</option>
            {SOURCE_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sort" className="text-sm font-medium">
            Sort by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={sortValue}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="border-input hover:bg-muted h-8 rounded-lg border px-3 text-sm font-medium"
        >
          Filter
        </button>
      </form>

      {bookings.length === 0 ? (
        <EmptyState
          title="No bookings for this filter"
          description="Create a booking or adjust the date/status filter above."
        />
      ) : (
        <BookingList bookings={bookings} />
      )}
    </div>
  );
}
