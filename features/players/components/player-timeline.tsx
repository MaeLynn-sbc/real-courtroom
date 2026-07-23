import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import type { PlayerTimelineEvent } from "@/services/player/player-timeline";

const TYPE_LABELS: Record<PlayerTimelineEvent["type"], string> = {
  BOOKING: "Booking",
  OPEN_PLAY_REGISTRATION: "Open Play",
  TOURNAMENT_REGISTRATION: "Tournament",
  MEMBERSHIP_EVENT: "Membership",
  SALE: "Sale",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export function PlayerTimeline({ events }: { events: PlayerTimelineEvent[] }) {
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
