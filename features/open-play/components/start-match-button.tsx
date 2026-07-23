"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { startNextMatchAction } from "@/actions/open-play.actions";
import { Button } from "@/components/ui/button";

const REASON_MESSAGES: Record<string, string> = {
  NOT_ENOUGH_PLAYERS: "Not enough players waiting to start a match (need 4).",
  NO_COURT_AVAILABLE: "No court is currently available.",
};

interface StartMatchButtonProps {
  sessionId: string;
}

export function StartMatchButton({ sessionId }: StartMatchButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const outcome = await startNextMatchAction(sessionId);
      if (outcome.error) {
        toast.error(outcome.error);
        return;
      }
      if (outcome.result && !outcome.result.started) {
        toast.info(REASON_MESSAGES[outcome.result.reason] ?? "Could not start a match.");
        return;
      }
      toast.success("Match started.");
      router.refresh();
    });
  }

  return (
    <Button type="button" disabled={isPending} onClick={handleClick}>
      {isPending ? "Starting…" : "Start next match"}
    </Button>
  );
}
