"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { generateBracketAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";

interface GenerateBracketButtonProps {
  tournamentId: string;
  categoryId: string;
}

export function GenerateBracketButton({ tournamentId, categoryId }: GenerateBracketButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await generateBracketAction(tournamentId, categoryId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Bracket generated.");
      router.refresh();
    });
  }

  return (
    <Button type="button" disabled={isPending} onClick={handleClick}>
      {isPending ? "Generating…" : "Generate bracket"}
    </Button>
  );
}
