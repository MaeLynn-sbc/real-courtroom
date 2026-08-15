"use client";

import { Mic, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { completeMatchAction, deleteMatchAction, markWalkoverAction, recordScoreAction } from "@/actions/tournament.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { teamNamesForSpeech } from "@/features/tournaments/lib/match-announcement";
import type { MatchStatus } from "@/lib/generated/prisma/enums";
import type { matchService } from "@/services/tournaments/match.service";

type Matches = Awaited<ReturnType<typeof matchService.listMatchesByCategory>>;
export type MatchWithTeams = Matches[number];

// Owner report (2026-08-11): "games have only 1 set per game" — a
// single game (not best-of-3). determineMatchWinner (match-status.ts)
// already makes no assumption about set count — it just checks which
// team won more of whatever Score rows exist — so this is a pure UI
// change, no service logic needed.
const SET_COUNT = 1;

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

// Owner request (2026-08-12): "can the team has numbers. like what
// number they are in the pool or bracket" — optional "1a"/"2a" prefix
// (bracket-generator.ts's formatTeamPoolNumber), null/undefined for an
// unassigned team or a match from before pools existed.
function teamLabel(team: MatchWithTeams["team1"] | MatchWithTeams["team2"], number?: string | null): string {
  if (!team) {
    return "BYE";
  }
  const player1Name = team.player1.user.name ?? team.player1.user.email ?? "Unknown player";
  const base = team.player2
    ? `${player1Name} / ${team.player2.user.name ?? team.player2.user.email ?? "Unknown player"}`
    : player1Name;
  return number ? `${number}. ${base}` : base;
}

interface MatchCardProps {
  tournamentId: string;
  categoryId: string;
  match: MatchWithTeams;
  teamPoolNumbers: Record<string, string | null>;
}

export function MatchCard({ tournamentId, categoryId, match, teamPoolNumbers }: MatchCardProps) {
  const team1Number = teamPoolNumbers[match.team1Id];
  const team2Number = match.team2Id ? teamPoolNumbers[match.team2Id] : null;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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

  // Owner report (2026-08-14): "cannot do it since it's scheduled" —
  // typing both scores into the Set input and clicking "Complete match"
  // directly (without first clicking that set's own small "Save" button)
  // left the match's status at SCHEDULED with no Score row in the
  // database at all, so completeMatch's transition guard rejected it —
  // and even relaxing that guard wouldn't have helped, since
  // completeMatch separately refuses to complete a match with no
  // decisive score recorded. Nothing here is actually about court/time
  // scheduling (that moved to the Scoresheet page entirely, see the
  // 2026-08-11 comment above) — "SCHEDULED" is just Match.status's
  // not-started-yet value. Fix: save every set that has both scores
  // typed in (recordScore upserts, so this is safe to re-run on an
  // already-saved set) before completing, so "Complete match" works
  // directly from a cold card exactly like the owner expects.
  function handleComplete() {
    handleAction(async () => {
      for (let index = 0; index < setScores.length; index += 1) {
        const row = setScores[index];
        if (row.team1.trim() === "" || row.team2.trim() === "") {
          continue;
        }
        const result = await recordScoreAction(tournamentId, categoryId, match.id, {
          setNumber: index + 1,
          team1Score: Number(row.team1),
          team2Score: Number(row.team2),
        });
        if (result.error) {
          return result;
        }
      }
      return completeMatchAction(tournamentId, categoryId, match.id);
    }, "Match completed.");
  }

  // Two separate utterances, not one run-on sentence — the browser's
  // Owner request (2026-08-15): "add here announce button... please
  // announce the players then announce who are the winners. put a mic
  // button" — clarified to fire manually, not automatically on
  // "Complete match", and to speak locally via this browser's own
  // speechSynthesis rather than through the TV/PA relay the
  // Scoresheet's Announce button uses — the laptop running this
  // score-entry card is itself plugged into the venue's speakers.
  // Two separate utterances, not one run-on sentence — the browser's
  // speech queue plays them back to back with a natural pause between,
  // so it genuinely reads as "announce the players, THEN announce the
  // winner" rather than everything blurring into one line.
  function handleAnnounceWinner() {
    if (!match.winnerTeamId || typeof window === "undefined" || !("speechSynthesis" in window)) {
      return;
    }
    const winnerTeam = match.winnerTeamId === match.team1Id ? match.team1 : match.team2;
    const team1Speech = teamNamesForSpeech(match.team1);
    const team2Speech = teamNamesForSpeech(match.team2);
    const winnerSpeech = teamNamesForSpeech(winnerTeam);
    if (!team1Speech || !team2Speech || !winnerSpeech) return;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`${team1Speech}, versus ${team2Speech}.`));
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(`The winner is ${winnerSpeech}.`));
  }

  function handleWalkover(winnerTeamId: string) {
    handleAction(
      () => markWalkoverAction(tournamentId, categoryId, match.id, { winnerTeamId }),
      "Walkover recorded.",
    );
  }

  // Owner request (2026-08-15), LIVE during the tournament: "manual
  // match ups and auto match ups. kindly make a button or option to
  // delete" — works for any match (manually created or auto-generated
  // by the bracket); the service itself refuses only the one genuinely
  // unsafe case (an already-advanced Single Elimination match), so the
  // button here doesn't need to duplicate that logic client-side, just
  // a confirmation before a destructive action.
  function handleDelete() {
    if (!window.confirm("Delete this match? This cannot be undone.")) {
      return;
    }
    handleAction(() => deleteMatchAction(tournamentId, categoryId, match.id), "Match deleted.");
  }

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">
            {teamLabel(match.team1, team1Number)} {isBye ? "" : "vs"}{" "}
            {isBye ? "" : teamLabel(match.team2, team2Number)}
          </CardTitle>
          <Badge variant={STATUS_VARIANTS[match.status]}>{STATUS_LABELS[match.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {isBye ? (
          <p className="text-muted-foreground text-sm">Automatic bye — advances without playing.</p>
        ) : (
          <>
            {/* Owner request (2026-08-11): "remove this and put it on
                other tabs. the schedule. it shouldnt conflict with the
                score cards" — court + scheduled-at assignment moved to
                the Scoresheet page (features/tournaments/components/
                scoresheet-view.tsx); this card is score entry only now,
                plain-text court display if one's already assigned. */}
            {match.court ? (
              <p className="text-muted-foreground text-sm">
                {match.court.name}
                {match.scheduledAt
                  ? ` · ${new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(match.scheduledAt)}`
                  : ""}
              </p>
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
                  Walkover: {teamLabel(match.team1, team1Number)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleWalkover(match.team2Id as string)}
                >
                  Walkover: {teamLabel(match.team2, team2Number)}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={handleDelete}
                  title="Delete this match"
                >
                  <Trash2 className="text-destructive size-3.5" />
                </Button>
              </div>
            ) : null}

            {match.winnerTeamId ? (
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium">
                  Winner:{" "}
                  {match.winnerTeamId === match.team1Id
                    ? teamLabel(match.team1, team1Number)
                    : teamLabel(match.team2, team2Number)}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleAnnounceWinner}
                  title="Announce the players and the winner"
                >
                  <Mic className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={handleDelete}
                  title="Delete this match"
                >
                  <Trash2 className="text-destructive size-3.5" />
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
