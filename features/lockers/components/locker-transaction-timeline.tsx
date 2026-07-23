import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { LockerTimelineEvent } from "@/services/lockers/locker-timeline";

const TYPE_LABELS: Record<LockerTimelineEvent["type"], string> = {
  RENTAL_ISSUED: "Rental",
  RENTAL_ENDED: "Ended",
  RENTAL_EXPIRED: "Expired",
  MAINTENANCE_LOGGED: "Maintenance",
  MAINTENANCE_RESOLVED: "Resolved",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function LockerTransactionTimeline({ events }: { events: LockerTimelineEvent[] }) {
  if (events.length === 0) {
    return <EmptyState title="No activity yet." />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {events.map((event, index) => (
        <li key={index} className="border-border flex flex-col gap-1 border-l-2 pl-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{TYPE_LABELS[event.type]}</Badge>
            <span className="text-muted-foreground text-xs">
              {dateTimeFormatter.format(event.occurredAt)}
            </span>
          </div>
          <p className="text-sm font-medium">{event.title}</p>
          {event.description ? (
            <p className="text-muted-foreground text-xs">{event.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
