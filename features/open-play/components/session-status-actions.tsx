"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { updateSessionStatusAction } from "@/actions/open-play.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { Button } from "@/components/ui/button";
import type { OpenPlaySessionStatus } from "@/lib/generated/prisma/enums";
// Only the pure state-machine module is imported here (no lib/env.ts /
// lib/prisma.ts in its dependency chain) — same rule as
// booking-status-actions.tsx: never import session.service.ts itself from
// a "use client" file.
import { OPEN_PLAY_SESSION_STATUS_TRANSITIONS } from "@/services/open-play/session-status";

const STATUS_ACTION_LABELS: Record<OpenPlaySessionStatus, string> = {
  SCHEDULED: "Mark scheduled",
  IN_PROGRESS: "Start session",
  COMPLETED: "Mark complete",
  CANCELLED: "Cancel session",
};

interface SessionStatusActionsProps {
  sessionId: string;
  currentStatus: OpenPlaySessionStatus;
}

export function SessionStatusActions({ sessionId, currentStatus }: SessionStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const availableTransitions = OPEN_PLAY_SESSION_STATUS_TRANSITIONS[currentStatus];

  function handleTransition(status: OpenPlaySessionStatus) {
    startTransition(async () => {
      const result = await updateSessionStatusAction(sessionId, { status });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Session updated.");
      router.refresh();
    });
  }

  if (availableTransitions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {availableTransitions.map((status) =>
        status === "CANCELLED" ? (
          <ConfirmActionButton
            key={status}
            title="Cancel this session?"
            description="This cancels the Open Play session for every registered player. This can't be undone."
            confirmLabel={STATUS_ACTION_LABELS[status]}
            cancelLabel="Keep session"
            disabled={isPending}
            onConfirm={() => handleTransition(status)}
          >
            {STATUS_ACTION_LABELS[status]}
          </ConfirmActionButton>
        ) : (
          <Button
            key={status}
            type="button"
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => handleTransition(status)}
          >
            {STATUS_ACTION_LABELS[status]}
          </Button>
        ),
      )}
    </div>
  );
}
