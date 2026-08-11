"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { generateBracketAction, resetBracketAction } from "@/actions/tournament.actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

// Owner request (2026-08-11): "can i remove this after all. these are
// all trials" — undoes generateBracket so trial matchups/brackets can
// be cleared and regenerated cleanly. Confirmed first (AlertDialog),
// same as every other real-delete button this session — this deletes
// actual Match/Score rows, not a status flip.
interface ResetBracketButtonProps {
  tournamentId: string;
  categoryId: string;
  isRoundRobin: boolean;
}

export function ResetBracketButton({ tournamentId, categoryId, isRoundRobin }: ResetBracketButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleReset() {
    startTransition(async () => {
      const result = await resetBracketAction(tournamentId, categoryId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isRoundRobin ? "Matchups cleared." : "Bracket reset.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {isRoundRobin ? "Reset matchups" : "Reset bracket"}
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{isRoundRobin ? "Reset matchups?" : "Reset bracket?"}</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes every match and score recorded so far for this category — there&apos;s no
            undo. Registrations stay untouched; you can create fresh {isRoundRobin ? "matchups" : "a bracket"}{" "}
            right after.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Keep it</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={handleReset}>
            {isPending ? "Resetting…" : "Reset"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
