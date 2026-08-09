"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  assignSpecialPlayerToCourtAction,
  checkInSpecialPlayerAction,
  checkOutSpecialPlayerAction,
  completeSpecialGameAction,
} from "@/actions/special-open-play.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SkillLevel } from "@/lib/generated/prisma/enums";

const COURT_LABELS = ["Court A", "Court B", "Court C"] as const;

const SKILL_LABELS: Record<SkillLevel, string> = {
  BEGINNER: "Beginner",
  INTERMEDIATE: "Intermediate",
  ADVANCED: "Advanced",
  PRO: "Pro",
};

export interface SpecialCheckIn {
  id: string;
  playerName: string;
  phone: string | null;
  skillLevel: SkillLevel | null;
  status: "WAITING" | "PLAYING" | "DONE";
  courtLabel: string | null;
}

// Owner request (2026-08-09): "an outside special court" — check-in +
// manual court assignment only, no auto-pairing, no Sale, no PlayerTab,
// no TV connection. See SpecialOpenPlayCheckIn's own schema comment for
// the full isolation rationale, and special-open-play.service.ts's own
// comment for why this stays deliberately simple.
export function SpecialOpenPlayBoard({
  dateValue,
  checkIns,
}: {
  dateValue: string;
  checkIns: SpecialCheckIn[];
}) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [isPending, startTransition] = useTransition();

  const waiting = checkIns.filter((c) => c.status === "WAITING");
  const playingByCourt = new Map(
    checkIns.filter((c) => c.status === "PLAYING" && c.courtLabel).map((c) => [c.courtLabel!, c]),
  );

  function refresh() {
    router.refresh();
  }

  function handleCheckIn() {
    if (!playerName.trim()) {
      toast.error("Enter a name.");
      return;
    }
    startTransition(async () => {
      const result = await checkInSpecialPlayerAction({
        date: dateValue,
        playerName: playerName.trim(),
        phone: phone.trim() || undefined,
        skillLevel: skillLevel || undefined,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName.trim()} checked in.`);
      setPlayerName("");
      setPhone("");
      setSkillLevel("");
      refresh();
    });
  }

  function handleAssign(checkInId: string, courtLabel: string) {
    startTransition(async () => {
      const result = await assignSpecialPlayerToCourtAction({ checkInId, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned to ${courtLabel}.`);
      refresh();
    });
  }

  function handleCompleteGame(checkInId: string) {
    startTransition(async () => {
      const result = await completeSpecialGameAction({ checkInId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Game marked done — back to Waiting.");
      refresh();
    });
  }

  function handleCheckOut(checkInId: string) {
    startTransition(async () => {
      const result = await checkOutSpecialPlayerAction({ checkInId });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Checked out.");
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Special Open Play</h1>
        <p className="text-muted-foreground text-sm">
          Private, temporary board for the outside special court. No fees, no Sale — check in, assign
          to a court, mark done.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Check in a player</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerName">Name</Label>
            <Input
              id="specialPlayerName"
              value={playerName}
              onChange={(event) => setPlayerName(event.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerPhone">Phone (optional)</Label>
            <Input
              id="specialPlayerPhone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={isPending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="specialPlayerSkill">Skill (optional)</Label>
            <Select
              value={skillLevel}
              onValueChange={(value) => setSkillLevel((value as SkillLevel) ?? "")}
            >
              <SelectTrigger id="specialPlayerSkill" className="w-full">
                <SelectValue>{() => (skillLevel ? SKILL_LABELS[skillLevel] : "Select")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SKILL_LABELS) as SkillLevel[]).map((level) => (
                  <SelectItem key={level} value={level}>
                    {SKILL_LABELS[level]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button type="button" disabled={isPending} onClick={handleCheckIn} className="w-full">
              Check in
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {COURT_LABELS.map((courtLabel) => {
          const occupant = playingByCourt.get(courtLabel);
          return (
            <Card key={courtLabel}>
              <CardHeader>
                <CardTitle className="text-base">{courtLabel}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {occupant ? (
                  <>
                    <p className="font-medium">{occupant.playerName}</p>
                    {occupant.skillLevel ? (
                      <p className="text-muted-foreground text-xs">{SKILL_LABELS[occupant.skillLevel]}</p>
                    ) : null}
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleCompleteGame(occupant.id)}
                      >
                        Mark done
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleCheckOut(occupant.id)}
                      >
                        Check out
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">Empty</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waiting ({waiting.length})</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {waiting.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nobody waiting.</p>
          ) : (
            waiting.map((checkIn) => (
              <div
                key={checkIn.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
              >
                <div>
                  <span className="font-medium">{checkIn.playerName}</span>
                  {checkIn.skillLevel ? (
                    <span className="text-muted-foreground ml-2 text-xs">
                      {SKILL_LABELS[checkIn.skillLevel]}
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {COURT_LABELS.map((courtLabel) => (
                    <Button
                      key={courtLabel}
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending || playingByCourt.has(courtLabel)}
                      onClick={() => handleAssign(checkIn.id, courtLabel)}
                    >
                      → {courtLabel}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => handleCheckOut(checkIn.id)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
