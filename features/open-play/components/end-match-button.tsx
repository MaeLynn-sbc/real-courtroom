"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { endMatchAction } from "@/actions/open-play.actions";
import { Button } from "@/components/ui/button";

interface EndMatchButtonProps {
  sessionId: string;
  courtId: string;
}

export function EndMatchButton({ sessionId, courtId }: EndMatchButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await endMatchAction(sessionId, courtId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Match ended — players moved to Resting.");
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleClick}>
      End match
    </Button>
  );
}
