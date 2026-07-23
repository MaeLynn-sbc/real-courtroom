"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { removeFromQueueAction, returnFromRestAction } from "@/actions/open-play.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { queueService } from "@/services/open-play/queue.service";

type QueueEntries = Awaited<ReturnType<typeof queueService.getQueue>>;
export type QueueEntry = QueueEntries[number];

interface QueueEntryCardProps {
  sessionId: string;
  entry: QueueEntry;
}

export function QueueEntryCard({ sessionId, entry }: QueueEntryCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const name =
    entry.registration.player?.user.name ??
    entry.registration.player?.user.email ??
    entry.registration.guestName ??
    "—";

  function handleAction(action: () => Promise<{ error: string | null }>) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card size="sm">
      <CardContent className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{name}</span>
        <div className="flex gap-1.5">
          {entry.status === "WAITING" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => handleAction(() => removeFromQueueAction(sessionId, entry.id))}
            >
              Remove
            </Button>
          ) : null}
          {entry.status === "RESTING" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handleAction(() => returnFromRestAction(sessionId, entry.id))}
            >
              Return to queue
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
