import { Card, CardContent } from "@/components/ui/card";
import type { OpenPlayQueueStats } from "@/services/open-play/rotation-engine";

const STAT_LABELS: Record<keyof OpenPlayQueueStats, string> = {
  waitingCount: "Waiting",
  playingCount: "Playing",
  restingCount: "Resting",
  waitlistCount: "Waitlist",
  availableCourts: "Available Courts",
  activeMatches: "Active Matches",
};

// Computed on read, never stored — see rotation-engine.ts's getQueueStats.
export function QueueStatsBar({ stats }: { stats: OpenPlayQueueStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {(Object.keys(STAT_LABELS) as Array<keyof OpenPlayQueueStats>).map((key) => (
        <Card key={key} size="sm">
          <CardContent className="flex flex-col items-center gap-1 py-1 text-center">
            <span className="text-2xl font-semibold tabular-nums">{stats[key]}</span>
            <span className="text-muted-foreground text-xs">{STAT_LABELS[key]}</span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
