import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActivityFeedEntry } from "@/services/activity/activity-feed.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

// Same feed analytics.service.ts already renders (under Administration) —
// surfaced here too since "what's happening right now" belongs on the
// daily-ops home, not one click deeper.
export function RecentActivityPanel({ entries }: { entries: ActivityFeedEntry[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">No recent activity.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {entries.map((entry) => (
              <li key={entry.id} className="flex flex-col">
                <span>{entry.label}</span>
                <span className="text-muted-foreground text-xs">
                  {entry.actorName ?? "System"} · {dateTimeFormatter.format(entry.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
