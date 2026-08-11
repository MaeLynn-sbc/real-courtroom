"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { generateBracketAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";

interface GenerateBracketButtonProps {
  tournamentId: string;
  categoryId: string;
  // Owner report (2026-08-10): "can we put the scoring here?" —
  // investigation found the scoring UI was already exactly here,
  // just hidden until this button is clicked; the real confusion was
  // this button/section being labeled "Bracket" even for ROUND_ROBIN,
  // which doesn't build an elimination tree at all — it creates
  // all-play-all match pairings. Format-aware copy so round robin
  // reads as what it actually does.
  isRoundRobin: boolean;
}

export function GenerateBracketButton({ tournamentId, categoryId, isRoundRobin }: GenerateBracketButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await generateBracketAction(tournamentId, categoryId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isRoundRobin ? "Matchups created." : "Bracket generated.");
      router.refresh();
    });
  }

  return (
    <Button type="button" disabled={isPending} onClick={handleClick}>
      {isPending ? "Creating…" : isRoundRobin ? "Create matchups" : "Generate bracket"}
    </Button>
  );
}
