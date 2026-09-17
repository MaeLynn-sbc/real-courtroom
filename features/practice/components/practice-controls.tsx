"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  addPracticePlayerAction,
  addSamplePracticePlayersAction,
  clearPracticeAction,
  removePracticePlayerAction,
  setPracticeTakeoverRtvAction,
  type PracticeActionState,
} from "@/actions/practice.actions";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { skillTextClass } from "@/types/open-play-skill-color";
import {
  OPEN_PLAY_SKILL_LEVEL_ORDER,
  OPEN_PLAY_SKILL_LEVELS,
} from "@/types/open-play-skill-levels";

export interface PracticePlayerRow {
  registrationId: string;
  playerName: string;
  skillLevel: OpenPlaySkillLevel;
  status: string;
}

// Owner (2026-09-17): a sandbox for the open play rotation with sample
// names, shown on the real /rtv while the switch is on. Nothing here can
// charge anyone — see lib/practice.ts.
export function PracticeControls({
  takeoverRtv,
  players,
}: {
  takeoverRtv: boolean;
  players: PracticePlayerRow[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [skill, setSkill] = useState<OpenPlaySkillLevel>("INTERMEDIATE");
  const [confirmClear, setConfirmClear] = useState(false);

  function run(promise: Promise<PracticeActionState>, success: string, after?: () => void) {
    startTransition(async () => {
      const result = await promise;
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(success);
      after?.();
      router.refresh();
    });
  }

  function addPlayer(event: React.FormEvent) {
    event.preventDefault();
    const playerName = name.trim();
    if (!playerName) return;
    run(
      addPracticePlayerAction({ playerName, skillLevel: skill }),
      `${playerName} added to practice.`,
      () => setName(""),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="font-medium">Show practice on /rtv</p>
            <p className="text-muted-foreground text-sm">
              {takeoverRtv
                ? "ON — the /rtv TV is showing practice, not live open play. Turn it off before real open play starts."
                : "OFF — /rtv shows live open play. /tv is never affected."}
            </p>
          </div>
          <Switch
            checked={takeoverRtv}
            disabled={isPending}
            aria-label="Show practice on /rtv"
            onCheckedChange={(value) =>
              run(
                setPracticeTakeoverRtvAction(value),
                value ? "/rtv now shows practice." : "/rtv is back to live open play.",
              )
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Practice players ({players.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Sample names only. They go straight into the practice line below, never appear on the
            Players tab, and are never charged. No sale is ever recorded for practice.
          </p>
          <form onSubmit={addPlayer} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="practiceName">Name</Label>
              <Input
                id="practiceName"
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Test Ana"
                className="w-56"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="practiceSkill">Skill</Label>
              <select
                id="practiceSkill"
                value={skill}
                onChange={(event) => setSkill(event.target.value as OpenPlaySkillLevel)}
                className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
              >
                {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
                  <option key={level} value={level}>
                    {OPEN_PLAY_SKILL_LEVELS[level].label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" disabled={isPending || !name.trim()}>
              Add to practice
            </Button>
          </form>

          {players.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {players.map((player) => (
                <li
                  key={player.registrationId}
                  className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
                >
                  <span className={`font-medium ${skillTextClass(player.skillLevel)}`}>
                    {player.playerName}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    ({OPEN_PLAY_SKILL_LEVELS[player.skillLevel].label})
                  </span>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-destructive ml-1 text-xs"
                    aria-label={`Remove ${player.playerName}`}
                    disabled={isPending}
                    onClick={() =>
                      run(
                        removePracticePlayerAction(player.registrationId),
                        `${player.playerName} removed.`,
                      )
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() =>
                startTransition(async () => {
                  const result = await addSamplePracticePlayersAction();
                  if (result.error) {
                    toast.error(result.error);
                    return;
                  }
                  toast.success(
                    result.added
                      ? `${result.added} sample players added.`
                      : "All sample players are already in practice.",
                  );
                  router.refresh();
                })
              }
            >
              Add sample players (10 per skill)
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={isPending || players.length === 0}
              onClick={() => setConfirmClear(true)}
            >
              Clear practice
            </Button>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all practice?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes every practice name, staged set and practice game. Real open play, players and
              sales are not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                run(clearPracticeAction(), "Practice cleared.", () => setConfirmClear(false))
              }
            >
              Clear practice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
