"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  completeMatchAction,
  markWalkoverAction,
  recordScoreAction,
  scheduleMatchAction,
} from "@/actions/tournament.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MatchStatus } from "@/lib/generated/prisma/enums";
import type { matchService } from "@/services/tournaments/match.service";

type Matches = Awaited<ReturnType<typeof matchService.listMatchesByCategory>>;
export type MatchWithTeams = Matches[number];

const NO_COURT_VALUE = "__none__";
const SET_COUNT = 3;

const STATUS_LABELS: Record<MatchStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  WALKOVER: "Walkover",
};

const STATUS_VARIANTS: Record<MatchStatus, "success" | "outline" | "destructive"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "success",
  COMPLETED: "success",
  CANCELLED: "destructive",
  WALKOVER: "success",
};

function teamLabel(team: MatchWithTeams["team1"] | MatchWithTeams["team2"]): string {
  if (!team) {
    return "BYE";
  }
  const player1Name = team.player1.user.name ?? team.player1.user.email ?? "Unknown player";
  if (!team.player2) {
    return player1Name;
  }
  return `${player1Name} / ${team.player2.user.name ?? team.player2.user.email ?? "Unknown player"}`;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

interface MatchCardProps {
  tournamentId: string;
  categoryId: string;
  match: MatchWithTeams;
  courts: { id: string; name: string }[];
}

export function MatchCard({ tournamentId, categoryId, match, courts }: MatchCardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [courtId, setCourtId] = useState(match.courtId ?? NO_COURT_VALUE);
  const [scheduledAt, setScheduledAt] = useState(
    match.scheduledAt ? toLocalInputValue(match.scheduledAt) : "",
  );
  const [setScores, setSetScores] = useState(() =>
    Array.from({ length: SET_COUNT }, (_, index) => {
      const existing = match.scores.find((score) => score.setNumber === index + 1);
      return { team1: existing ? String(existing.team1Score) : "", team2: existing ? String(existing.team2Score) : "" };
    }),
  );

  const isEditable = match.status === "SCHEDULED" || match.status === "IN_PROGRESS";
  const isBye = match.team2 === null;

  function handleAction(action: () => Promise<{ error: string | null }>, successMessage?: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      if (successMessage) {
        toast.success(successMessage);
      }
      router.refresh();
    });
  }

  function handleSaveSchedule() {
    handleAction(
      () =>
        scheduleMatchAction(tournamentId, categoryId, match.id, {
          courtId: courtId === NO_COURT_VALUE ? undefined : courtId,
          scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
        }),
      "Match scheduled.",
    );
  }

  function handleSaveSet(setNumber: number) {
    const row = setScores[setNumber - 1];
    const team1Score = Number(row.team1);
    const team2Score = Number(row.team2);
    if (row.team1.trim() === "" || row.team2.trim() === "") {
      toast.error("Enter both scores for this set.");
      return;
    }
    handleAction(
      () => recordScoreAction(tournamentId, categoryId, match.id, { setNumber, team1Score, team2Score }),
      `Set ${setNumber} saved.`,
    );
  }

  function handleComplete() {
    handleAction(() => completeMatchAction(tournamentId, categoryId, match.id), "Match completed.");
  }

  function handleWalkover(winnerTeamId: string) {
    handleAction(
      () => markWalkoverAction(tournamentId, categoryId, match.id, { winnerTeamId }),
      "Walkover recorded.",
    );
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {teamLabel(match.team1)} {isBye ? "" : "vs"} {isBye ? "" : teamLabel(match.team2)}
          </CardTitle>
          <Badge variant={STATUS_VARIANTS[match.status]}>{STATUS_LABELS[match.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isBye ? (
          <p className="text-muted-foreground text-sm">Automatic bye — advances without playing.</p>
        ) : (
          <>
            {isEditable ? (
              <div className="flex flex-wrap items-end gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">Court</label>
                  <Select value={courtId} onValueChange={(value) => setCourtId(value ?? NO_COURT_VALUE)}>
                    <SelectTrigger className="w-40">
                      <SelectValue placeholder="No court">
                        {(value: string) =>
                          value === NO_COURT_VALUE
                            ? "No court"
                            : (courts.find((court) => court.id === value)?.name ?? "No court")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_COURT_VALUE}>No court</SelectItem>
                      {courts.map((court) => (
                        <SelectItem key={court.id} value={court.id}>
                          {court.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">Scheduled at</label>
                  <Input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(event) => setScheduledAt(event.target.value)}
                    className="w-48"
                  />
                </div>
                <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleSaveSchedule}>
                  Save schedule
                </Button>
              </div>
            ) : match.court ? (
              <p className="text-muted-foreground text-sm">{match.court.name}</p>
            ) : null}

            <div className="flex flex-col gap-2">
              {setScores.map((row, index) => (
                <div key={index} className="flex items-center gap-2">
                  <span className="w-12 text-xs font-medium">Set {index + 1}</span>
                  <Input
                    type="number"
                    min={0}
                    className="w-16"
                    value={row.team1}
                    disabled={!isEditable}
                    onChange={(event) => {
                      const next = [...setScores];
                      next[index] = { ...next[index], team1: event.target.value };
                      setSetScores(next);
                    }}
                  />
                  <span className="text-muted-foreground text-xs">–</span>
                  <Input
                    type="number"
                    min={0}
                    className="w-16"
                    value={row.team2}
                    disabled={!isEditable}
                    onChange={(event) => {
                      const next = [...setScores];
                      next[index] = { ...next[index], team2: event.target.value };
                      setSetScores(next);
                    }}
                  />
                  {isEditable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleSaveSet(index + 1)}
                    >
                      Save
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>

            {isEditable && match.team1 && match.team2 ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" disabled={isPending} onClick={handleComplete}>
                  Complete match
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleWalkover(match.team1Id)}
                >
                  Walkover: {teamLabel(match.team1)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleWalkover(match.team2Id as string)}
                >
                  Walkover: {teamLabel(match.team2)}
                </Button>
              </div>
            ) : null}

            {match.winnerTeamId ? (
              <p className="text-sm font-medium">
                Winner:{" "}
                {match.winnerTeamId === match.team1Id ? teamLabel(match.team1) : teamLabel(match.team2)}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
