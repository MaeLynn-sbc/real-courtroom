"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  cancelRegistrationAction,
  deleteRegistrationAction,
  updateRegistrationPlayerNamesAction,
} from "@/actions/tournament.actions";
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
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TournamentRegistrationStatus } from "@/lib/generated/prisma/enums";
import { formatTeamPoolNumber } from "@/services/tournaments/bracket-generator";
import type { tournamentService } from "@/services/tournaments/tournament.service";

type CategoryWithRegistrations = NonNullable<
  Awaited<ReturnType<typeof tournamentService.getCategoryById>>
>;
type Registrations = CategoryWithRegistrations["registrations"];
type RegistrationRow = Registrations[number];

const STATUS_LABELS: Record<TournamentRegistrationStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  WAITLISTED: "Waitlisted",
  WITHDRAWN: "Withdrawn",
  DISQUALIFIED: "Disqualified",
};

const STATUS_VARIANTS: Record<TournamentRegistrationStatus, "success" | "outline" | "destructive"> = {
  PENDING: "outline",
  CONFIRMED: "success",
  WAITLISTED: "outline",
  WITHDRAWN: "destructive",
  DISQUALIFIED: "destructive",
};

function teamDisplayName(team: RegistrationRow["team"]): string {
  const player1Name = team.player1.user.name ?? team.player1.user.email ?? "Unknown player";
  if (!team.player2) {
    return player1Name;
  }
  const player2Name = team.player2.user.name ?? team.player2.user.email ?? "Unknown player";
  return `${player1Name} / ${player2Name}`;
}

interface RegistrationListProps {
  tournamentId: string;
  categoryId: string;
  registrations: Registrations;
  // Owner request (2026-08-05): Delete has to disappear once a bracket
  // exists — deleteRegistration's own guard refuses it server-side
  // regardless, this just avoids showing a button guaranteed to fail.
  // Edit stays available either way — a name correction can't break an
  // existing bracket.
  bracketGenerated: boolean;
}

// Owner request (2026-08-05): "add option to delete and edit, to those
// who cancelled or typo errors." Edit is an inline two-field form (no
// separate dialog — same "just expand in place" pattern
// OverrideStartingBalanceForm already uses elsewhere); Delete is
// destructive and reason-free, so it gets a real confirmation dialog.
// Both are server-enforced beyond what's shown here (see
// tournamentService.deleteRegistration/updateRegistrationPlayerNames'
// own comments) — this UI only decides what to show, never the last
// word on what's allowed.
export function RegistrationList({
  tournamentId,
  categoryId,
  registrations,
  bracketGenerated,
}: RegistrationListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlayer1, setEditPlayer1] = useState("");
  const [editPlayer2, setEditPlayer2] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  function handleCancel(registrationId: string) {
    startTransition(async () => {
      const result = await cancelRegistrationAction(tournamentId, categoryId, registrationId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function startEditing(registration: RegistrationRow) {
    setEditingId(registration.id);
    setEditPlayer1(registration.team.player1.user.name ?? "");
    setEditPlayer2(registration.team.player2?.user.name ?? "");
  }

  function handleSaveNames(registration: RegistrationRow) {
    startTransition(async () => {
      const result = await updateRegistrationPlayerNamesAction(tournamentId, categoryId, registration.id, {
        player1Name: editPlayer1.trim(),
        player2Name: registration.team.player2 ? editPlayer2.trim() : undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Names updated.");
      setEditingId(null);
      router.refresh();
    });
  }

  function handleDelete(registrationId: string) {
    startTransition(async () => {
      const result = await deleteRegistrationAction(tournamentId, categoryId, registrationId);
      setPendingDeleteId(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Registration deleted.");
      router.refresh();
    });
  }

  if (registrations.length === 0) {
    return <EmptyState title="No teams registered yet." />;
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Team</TableHead>
            <TableHead>Pool #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Receipt</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {registrations.map((registration) => {
            const isEditing = editingId === registration.id;
            // Sale rides along on getCategoryById's registrations include
            // specifically so this can hide Delete before the click, not
            // just refuse it server-side after.
            const hasSale = registration.sale !== null;

            return (
              <TableRow key={registration.id}>
                <TableCell>
                  {isEditing ? (
                    <div className="flex flex-col gap-1.5">
                      <Input
                        value={editPlayer1}
                        onChange={(event) => setEditPlayer1(event.target.value)}
                        placeholder="Player 1 name"
                      />
                      {registration.team.player2 ? (
                        <Input
                          value={editPlayer2}
                          onChange={(event) => setEditPlayer2(event.target.value)}
                          placeholder="Player 2 name"
                        />
                      ) : null}
                    </div>
                  ) : (
                    teamDisplayName(registration.team)
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatTeamPoolNumber(registration.poolLabel, registration.poolPosition) ?? "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANTS[registration.status]}>
                    {STATUS_LABELS[registration.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {registration.receiptStorageKey ? (
                    <a
                      href={`/api/tournament-registration-receipt/${encodeURIComponent(registration.receiptStorageKey)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary text-sm underline underline-offset-2"
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-muted-foreground text-sm">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          disabled={isPending}
                          onClick={() => handleSaveNames(registration)}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={isPending}
                          onClick={() => setEditingId(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {registration.status === "CONFIRMED" || registration.status === "WAITLISTED" ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={isPending}
                            onClick={() => handleCancel(registration.id)}
                          >
                            Withdraw
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={isPending}
                          onClick={() => startEditing(registration)}
                        >
                          Edit
                        </Button>
                        {!bracketGenerated && !hasSale ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={isPending}
                            onClick={() => setPendingDeleteId(registration.id)}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <AlertDialog open={pendingDeleteId !== null} onOpenChange={(open) => !open && setPendingDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this registration?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the registration and the player entries typed for it — not
              just marks it withdrawn. Only offered here because no payment is on record for it.
              This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() => pendingDeleteId && handleDelete(pendingDeleteId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
