import { EmptyState } from "@/components/shared/empty-state";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import type { BookingHistory } from "@/lib/generated/prisma/client";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface BookingHistoryListProps {
  history: BookingHistory[];
}

export function BookingHistoryList({ history }: BookingHistoryListProps) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        description="Status changes for this booking will appear here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {history.map((entry) => (
        <li key={entry.id} className="rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <BookingStatusBadge status={entry.status} />
            <span className="text-muted-foreground text-sm">
              {dateTimeFormatter.format(entry.createdAt)}
            </span>
          </div>
          {entry.note ? <p className="text-muted-foreground mt-2 text-sm">{entry.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}
