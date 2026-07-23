import { EndMatchButton } from "@/features/open-play/components/end-match-button";
import { QueueEntryCard } from "@/features/open-play/components/queue-entry-card";
import type { rotationEngine } from "@/services/open-play/rotation-engine";

type RotationView = Awaited<ReturnType<typeof rotationEngine.getRotationView>>;
type PlayingEntry = RotationView["playing"][number];

interface RotationBoardProps {
  sessionId: string;
  rotationView: RotationView;
}

function groupByCourt(entries: PlayingEntry[]): Map<string, { courtName: string; entries: PlayingEntry[] }> {
  const groups = new Map<string, { courtName: string; entries: PlayingEntry[] }>();

  for (const entry of entries) {
    if (!entry.courtId || !entry.court) {
      continue;
    }
    const group = groups.get(entry.courtId);
    if (group) {
      group.entries.push(entry);
    } else {
      groups.set(entry.courtId, { courtName: entry.court.name, entries: [entry] });
    }
  }

  return groups;
}

export function RotationBoard({ sessionId, rotationView }: RotationBoardProps) {
  const playingByCourt = groupByCourt(rotationView.playing);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Waiting ({rotationView.waiting.length})</h3>
        <div className="flex flex-col gap-2">
          {rotationView.waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">No one waiting.</p>
          ) : (
            rotationView.waiting.map((entry) => (
              <QueueEntryCard key={entry.id} sessionId={sessionId} entry={entry} />
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Playing ({rotationView.playing.length})</h3>
        <div className="flex flex-col gap-3">
          {playingByCourt.size === 0 ? (
            <p className="text-muted-foreground text-sm">No matches in progress.</p>
          ) : (
            Array.from(playingByCourt.entries()).map(([courtId, group]) => (
              <div key={courtId} className="flex flex-col gap-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{group.courtName}</span>
                  <EndMatchButton sessionId={sessionId} courtId={courtId} />
                </div>
                <div className="flex flex-col gap-2">
                  {group.entries.map((entry) => (
                    <QueueEntryCard key={entry.id} sessionId={sessionId} entry={entry} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Resting ({rotationView.resting.length})</h3>
        <div className="flex flex-col gap-2">
          {rotationView.resting.length === 0 ? (
            <p className="text-muted-foreground text-sm">No one resting.</p>
          ) : (
            rotationView.resting.map((entry) => (
              <QueueEntryCard key={entry.id} sessionId={sessionId} entry={entry} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
