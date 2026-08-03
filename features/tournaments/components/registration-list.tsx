"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { cancelRegistrationAction } from "@/actions/tournament.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TournamentRegistrationStatus } from "@/lib/generated/prisma/enums";
import type { tournamentService } from "@/services/tournaments/tournament.service";

type CategoryWithRegistrations = NonNullable<
  Awaited<ReturnType<typeof tournamentService.getCategoryById>>
>;
type Registrations = CategoryWithRegistrations["registrations"];

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

function teamDisplayName(team: Registrations[number]["team"]): string {
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
}

export function RegistrationList({ tournamentId, categoryId, registrations }: RegistrationListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  if (registrations.length === 0) {
    return <EmptyState title="No teams registered yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Team</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Receipt</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registrations.map((registration) => (
          <TableRow key={registration.id}>
            <TableCell>{teamDisplayName(registration.team)}</TableCell>
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
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
