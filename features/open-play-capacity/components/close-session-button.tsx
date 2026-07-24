"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { closeSessionAction } from "@/actions/player-tab.actions";
import { Button } from "@/components/ui/button";

export function CloseSessionButton({ sessionId, disabled }: { sessionId: string; disabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClose() {
    startTransition(async () => {
      const result = await closeSessionAction({ sessionId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Session closed.");
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={isPending || disabled} onClick={handleClose}>
      Close session
    </Button>
  );
}
