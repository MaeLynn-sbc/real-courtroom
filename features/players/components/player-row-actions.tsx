"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deletePlayerAction } from "@/actions/player.actions";
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
import { Button, buttonVariants } from "@/components/ui/button";

// Edit + Delete on each row of the players list (owner, 2026-09-17:
// "put a button for me to delete or edit it"). Walk-in check-ins with a
// junk phone ("1", ".") create a fresh player every visit, so the list
// fills with duplicates; this is how the owner clears them by hand.
// Delete is the existing soft delete (Player.deletedAt): the row leaves
// every list, but its registrations and sales keep their history.
export function PlayerRowActions({ playerId, playerName }: { playerId: string; playerName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex items-center justify-end gap-1">
      <Link href={`/dashboard/players/${playerId}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
        Edit
      </Link>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        Delete
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {playerName}?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes this player from the list and from check-in matching. Past registrations,
              bookings and sales stay on record under this name. Use it for duplicate or mistaken
              entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deletePlayerAction(playerId);
                  if (result.error) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(`${playerName} deleted.`);
                  setOpen(false);
                  router.refresh();
                });
              }}
            >
              {isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
