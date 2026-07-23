import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { EquipmentTimelineEvent } from "@/services/equipment/equipment-timeline";

const TYPE_LABELS: Record<EquipmentTimelineEvent["type"], string> = {
  RENTAL_ISSUED: "Rental",
  RENTAL_RETURNED: "Return",
  RENTAL_LOST: "Lost",
  MAINTENANCE_LOGGED: "Maintenance",
  MAINTENANCE_RESOLVED: "Resolved",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function EquipmentTransactionTimeline({ events }: { events: EquipmentTimelineEvent[] }) {
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
