"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { correctTeamPoolAssignmentAction, createPoolsAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Team {
  teamId: string;
  name: string;
  poolLabel: string | null;
  poolPosition: number | null;
  number: string | null;
}

interface PoolAssignmentFormProps {
  tournamentId: string;
  categoryId: string;
  confirmedCount: number;
  bracketGenerated: boolean;
  pools: { poolLabel: string; teams: { teamId: string; name: string; number: string | null }[] }[];
  teams: Team[];
}

const MODE_POOL_COUNT = "poolCount";
const MODE_TEAMS_PER_POOL = "teamsPerPool";
const UNASSIGNED_VALUE = "__unassigned__";
const POOL_LETTER_OPTIONS = ["A", "B", "C", "D", "E", "F"];

// Owner request (2026-08-13): "can i hva a pool players list. edit it
// and change it" — a real incident: a live tournament's pools were
// drawn before team numbers existed, so every team showed no number,
// and there was no way back in once matches existed. Each row now
// edits pool + position together via correctTeamPoolAssignmentAction
// (no "matches already generated" guard — see that action's own
// comment), not the old auto-append setTeamPoolAction, and stays
// editable regardless of whether a bracket exists.
function TeamPoolRow({
  tournamentId,
  categoryId,
  team,
}: {
  tournamentId: string;
  categoryId: string;
  team: Team;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [poolLabel, setPoolLabel] = useState(team.poolLabel ?? UNASSIGNED_VALUE);
  const [position, setPosition] = useState(team.poolPosition ? String(team.poolPosition) : "");

  const isUnassigned = poolLabel === UNASSIGNED_VALUE;
  const isDirty = (isUnassigned ? null : poolLabel) !== team.poolLabel || (isUnassigned ? "" : position) !== (team.poolPosition ? String(team.poolPosition) : "");

  function handleSave() {
    const resolvedPoolLabel = isUnassigned ? null : poolLabel;
    const resolvedPosition = isUnassigned ? null : Number(position);
    if (!isUnassigned && (!position.trim() || !Number.isInteger(resolvedPosition) || resolvedPosition! < 1)) {
      toast.error("Enter a real position number (1, 2, 3...) for this pool.");
      return;
    }
    startTransition(async () => {
      const result = await correctTeamPoolAssignmentAction(tournamentId, categoryId, {
        teamId: team.teamId,
        poolLabel: resolvedPoolLabel,
        poolPosition: resolvedPosition,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        resolvedPoolLabel
          ? `${team.name} → ${resolvedPosition}${resolvedPoolLabel.toLowerCase()}.`
          : `${team.name} unassigned.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm">
        {team.number ? <span className="text-muted-foreground">{team.number}. </span> : null}
        {team.name}
      </span>
      <div className="flex items-center gap-2">
        <Select
          value={poolLabel}
          onValueChange={(next) => next && setPoolLabel(next)}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue>{isUnassigned ? "Unassigned" : `Pool ${poolLabel}`}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNASSIGNED_VALUE}>Unassigned</SelectItem>
            {POOL_LETTER_OPTIONS.map((letter) => (
              <SelectItem key={letter} value={letter}>
                Pool {letter}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          min={1}
          placeholder="#"
          className="h-8 w-14 text-xs"
          disabled={isUnassigned}
          value={position}
          onChange={(event) => setPosition(event.target.value)}
        />
        <Button type="button" size="sm" variant="outline" disabled={isPending || !isDirty} onClick={handleSave}>
          Save
        </Button>
      </div>
    </div>
  );
}

// Owner request (2026-08-11): "create 2 brackets with option of 3 or 4
// or equally divide the players for the bracket created. then it will
// auto create the match" — two ways to say the same thing: pick how
// many pools you want, or pick roughly how many teams should be in
// each. Both resolve to a single poolCount before calling the action;
// createPoolsAction only ever knows poolCount, not "3 or 4 per pool."
export function PoolAssignmentForm({
  tournamentId,
  categoryId,
  confirmedCount,
  bracketGenerated,
  pools,
  teams,
}: PoolAssignmentFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<typeof MODE_POOL_COUNT | typeof MODE_TEAMS_PER_POOL>(MODE_POOL_COUNT);
  const [value, setValue] = useState("2");

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue < 1) return;

    const poolCount =
      mode === MODE_POOL_COUNT ? parsedValue : Math.max(1, Math.ceil(confirmedCount / parsedValue));

    startTransition(async () => {
      const result = await createPoolsAction(tournamentId, categoryId, { poolCount });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Drew ${poolCount} pool${poolCount === 1 ? "" : "s"}.`);
      router.refresh();
    });
  }

  if (confirmedCount < 2) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {!bracketGenerated ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create pools</CardTitle>
          </CardHeader>
          <form onSubmit={handleSubmit}>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-xs">
                Randomly splits the {confirmedCount} confirmed teams into pools, then Create matchups
                below will build a separate round robin within each one. Re-running this redraws
                everyone fresh — use it as a starting point, then fix individual teams below.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="poolMode">Split by</Label>
                  <Select
                    value={mode}
                    onValueChange={(next) => next && setMode(next as typeof mode)}
                  >
                    <SelectTrigger id="poolMode">
                      <SelectValue>
                        {mode === MODE_POOL_COUNT ? "Number of pools" : "Teams per pool"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={MODE_POOL_COUNT}>Number of pools</SelectItem>
                      <SelectItem value={MODE_TEAMS_PER_POOL}>Teams per pool</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="poolValue">
                    {mode === MODE_POOL_COUNT ? "Number of pools" : "Teams per pool (e.g. 3 or 4)"}
                  </Label>
                  <Input
                    id="poolValue"
                    type="number"
                    min={1}
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={isPending} className="w-full">
                    {isPending ? "Drawing…" : pools.length > 0 ? "Redraw pools" : "Create pools"}
                  </Button>
                </div>
              </div>

              {pools.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {pools.map((pool) => (
                    <div key={pool.poolLabel} className="rounded-md border p-2">
                      <p className="text-xs font-semibold">Pool {pool.poolLabel}</p>
                      <ul className="text-muted-foreground mt-1 text-xs">
                        {pool.teams.map((team) => (
                          <li key={team.teamId}>
                            {team.number ? `${team.number}. ` : ""}
                            {team.name}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </form>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pool players</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            Edit any team&apos;s pool and number by hand — e.g. as the live wheel-of-fortune draw
            names each team, or to fix a number after the fact. Works even once matchups have
            already been generated; it never moves an already-created match to a different pool.
          </p>
          <div className="flex flex-col divide-y">
            {teams.map((team) => (
              <TeamPoolRow key={team.teamId} tournamentId={tournamentId} categoryId={categoryId} team={team} />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
