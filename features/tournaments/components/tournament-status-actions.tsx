"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { updateTournamentStatusAction } from "@/actions/tournament.actions";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { Button } from "@/components/ui/button";
import type { TournamentStatus } from "@/lib/generated/prisma/enums";
// Only the pure state-machine module is imported here (no lib/env.ts /
// lib/prisma.ts in its dependency chain) — never import
// tournament.service.ts itself from a "use client" file.
import { TOURNAMENT_STATUS_TRANSITIONS } from "@/services/tournaments/tournament-status";

const STATUS_ACTION_LABELS: Record<TournamentStatus, string> = {
  DRAFT: "Mark draft",
  REGISTRATION_OPEN: "Open registration",
  REGISTRATION_CLOSED: "Close registration",
  IN_PROGRESS: "Start tournament",
  COMPLETED: "Mark complete",
  CANCELLED: "Cancel tournament",
};

interface TournamentStatusActionsProps {
  tournamentId: string;
  currentStatus: TournamentStatus;
}

export function TournamentStatusActions({ tournamentId, currentStatus }: TournamentStatusActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const availableTransitions = TOURNAMENT_STATUS_TRANSITIONS[currentStatus];

  function handleTransition(status: TournamentStatus) {
    startTransition(async () => {
      const result = await updateTournamentStatusAction(tournamentId, { status });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tournament updated.");
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
            title="Cancel this tournament?"
            description="This cancels the tournament for every registered team. This can't be undone."
            confirmLabel={STATUS_ACTION_LABELS[status]}
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
