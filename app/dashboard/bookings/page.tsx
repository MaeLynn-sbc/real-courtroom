import { PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { BookingList } from "@/features/bookings/components/booking-list";
import { BookingsFilterForm } from "@/features/bookings/components/bookings-filter-form";
import type { BookingSource, BookingStatus } from "@/lib/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Bookings",
};

const STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  PAID: "Paid",
  CHECKED_IN: "Checked In",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No Show",
  AWAITING_PAYMENT: "Awaiting Payment",
  PENDING_VERIFICATION: "Pending Verification",
  REJECTED: "Rejected",
  REFUNDED: "Refunded",
};

type TabKey = "active" | "completed" | "closed";

// Reported live: cancelled bookings sitting mixed in with a day's active
// ones on one flat list read as clutter, not history. Grouped by what
// staff actually do with each bucket, not one tab per literal status
// (9 real statuses was too many to scan at a glance) — Active is what
// might still need attention today, Completed is the plain record of
// what happened, Closed is everything that didn't happen (cancelled,
// no-show, rejected) or was undone (refunded). The Status dropdown below
// still works WITHIN a tab for finer filtering — switching tabs only
// changes which group of statuses it's allowed to pick from.
const TAB_STATUS_GROUPS: Record<TabKey, BookingStatus[]> = {
  active: ["PENDING", "CONFIRMED", "CHECKED_IN", "AWAITING_PAYMENT", "PENDING_VERIFICATION"],
  completed: ["COMPLETED"],
  closed: ["CANCELLED", "NO_SHOW", "REJECTED", "REFUNDED"],
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "closed", label: "Closed" },
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
  searchParams: Promise<{
    date?: string;
    status?: string;
    source?: string;
    sort?: string;
    tab?: string;
  }>;
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
    tab: tabParam,
  } = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "active";
  const tabStatuses = TAB_STATUS_GROUPS[tab];
  const dateValue = dateParam ?? todayInputValue();
  // Only a status belonging to the CURRENT tab is honored — switching
  // tabs via the links below drops the status param entirely (see
  // tabHref), so this only ever matters for a same-tab Filter submit; a
  // hand-crafted URL mixing tab and a foreign status just falls back to
  // "All" for that tab rather than leaking another tab's status through.
  const statusValue = tabStatuses.includes(statusParam as BookingStatus)
    ? (statusParam as BookingStatus)
    : undefined;
  const sourceValue = SOURCE_FILTER_OPTIONS.some((option) => option.value === sourceParam)
    ? (sourceParam as BookingSource)
    : undefined;
  const sortValue = sortParam === "createdAt" ? "createdAt" : "startAt";

  const bookings = await bookingService.listBookings({
    date: new Date(`${dateValue}T00:00:00`),
    status: statusValue,
    statusIn: statusValue ? undefined : tabStatuses,
    source: sourceValue,
    sortBy: sortValue,
  });

  // Date/source/sort carry across a tab switch (genuinely orthogonal
  // filters); status is deliberately dropped — a status from the OLD
  // tab's group is meaningless in the new one.
  function tabHref(key: TabKey): string {
    const params = new URLSearchParams();
    params.set("tab", key);
    if (dateParam) params.set("date", dateParam);
    if (sourceValue) params.set("source", sourceValue);
    if (sortParam) params.set("sort", sortParam);
    return `?${params.toString()}`;
  }

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
            href="/dashboard/bookings/stale-holds"
            className={buttonVariants({ variant: "outline" })}
          >
            Stale holds
          </Link>
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

      <div role="tablist" aria-label="Booking status group" className="flex gap-1 border-b">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            role="tab"
            aria-selected={tab === t.key}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <BookingsFilterForm
        tab={tab}
        dateValue={dateValue}
        statusValue={statusValue ?? ""}
        sourceValue={sourceValue ?? ""}
        sortValue={sortValue}
        statusOptions={tabStatuses.map((status) => ({
          value: status,
          label: STATUS_LABELS[status],
        }))}
        sourceOptions={SOURCE_FILTER_OPTIONS.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        sortOptions={SORT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
      />

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
