"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  announceSpecialCourtAction,
  assignSpecialGroupToCourtAction,
  checkInSpecialPlayerAction,
  checkOutSpecialPlayerAction,
  completeSpecialCourtGameAction,
} from "@/actions/special-open-play.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SkillLevel } from "@/lib/generated/prisma/enums";

const COURT_LABELS = ["Court 1", "Court 2", "Court 3"] as const;
const MAX_PLAYERS_PER_COURT = 4;

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

// Owner request (2026-08-09): "an outside special court... like i can
// form a group and put it to court a." Check-in + manual GROUP court
// assignment (up to 4 at once), a manual Announce button per court
// (watched by the isolated /specialtv display), no auto-pairing, no
// Sale, no PlayerTab, no connection to the real Open Play system.
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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const waiting = checkIns.filter((c) => c.status === "WAITING");
  const playingByCourt = new Map<string, SpecialCheckIn[]>();
  for (const checkIn of checkIns) {
    if (checkIn.status === "PLAYING" && checkIn.courtLabel) {
      const existing = playingByCourt.get(checkIn.courtLabel);
      if (existing) {
        existing.push(checkIn);
      } else {
        playingByCourt.set(checkIn.courtLabel, [checkIn]);
      }
    }
  }

  function refresh() {
    router.refresh();
  }

  function toggleSelected(checkInId: string) {
    setSelectedIds((current) =>
      current.includes(checkInId) ? current.filter((id) => id !== checkInId) : [...current, checkInId],
    );
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

  function handleAssignGroup(courtLabel: string) {
    if (selectedIds.length === 0) {
      toast.error("Select at least one player first.");
      return;
    }
    startTransition(async () => {
      const result = await assignSpecialGroupToCourtAction({ checkInIds: selectedIds, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${selectedIds.length} player(s) assigned to ${courtLabel}.`);
      setSelectedIds([]);
      refresh();
    });
  }

  function handleCompleteGame(courtLabel: string) {
    startTransition(async () => {
      const result = await completeSpecialCourtGameAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${courtLabel} game marked done — back to Waiting.`);
      refresh();
    });
  }

  function handleAnnounce(courtLabel: string) {
    startTransition(async () => {
      const result = await announceSpecialCourtAction({ date: dateValue, courtLabel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Announced ${courtLabel}.`);
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
      setSelectedIds((current) => current.filter((id) => id !== checkInId));
      refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Special Open Play</h1>
        <p className="text-muted-foreground text-sm">
          Private, temporary board for the outside special court. No fees, no Sale — check in, select a
          group, assign to a court, mark done.
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
          const occupants = playingByCourt.get(courtLabel) ?? [];
          const remaining = MAX_PLAYERS_PER_COURT - occupants.length;
          return (
            <Card key={courtLabel}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{courtLabel}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {occupants.length}/{MAX_PLAYERS_PER_COURT}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {occupants.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {occupants.map((occupant) => (
                      <li key={occupant.id} className="text-sm">
                        {occupant.playerName}
                        {occupant.skillLevel ? (
                          <span className="text-muted-foreground ml-1 text-xs">
                            ({SKILL_LABELS[occupant.skillLevel]})
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">Empty</p>
                )}

                {selectedIds.length > 0 && remaining > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={isPending || selectedIds.length > remaining}
                    onClick={() => handleAssignGroup(courtLabel)}
                  >
                    Assign selected ({selectedIds.length}) here
                  </Button>
                ) : null}

                {occupants.length > 0 ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleAnnounce(courtLabel)}
                    >
                      Announce
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleCompleteGame(courtLabel)}
                    >
                      Mark done
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Waiting ({waiting.length})
            {selectedIds.length > 0 ? (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                {selectedIds.length} selected
              </span>
            ) : null}
          </CardTitle>
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
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(checkIn.id)}
                    onChange={() => toggleSelected(checkIn.id)}
                    disabled={isPending}
                  />
                  <span className="font-medium">{checkIn.playerName}</span>
                  {checkIn.skillLevel ? (
                    <span className="text-muted-foreground text-xs">{SKILL_LABELS[checkIn.skillLevel]}</span>
                  ) : null}
                </label>
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
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
