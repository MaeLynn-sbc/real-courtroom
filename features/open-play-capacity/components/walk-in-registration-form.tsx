"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { registerAndCheckInAction } from "@/actions/open-play-checkin.actions";
import { registerWalkInAction } from "@/actions/open-play-registration.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

export interface RegistrablePlayer {
  id: string;
  name: string;
  phone: string;
  openPlaySkillLevel: OpenPlaySkillLevel | null;
}

type NightTarget = { sessionId: string } | { date: string };

interface WalkInRegistrationFormProps {
  target: NightTarget;
  players: RegistrablePlayer[];
  // Weeknight has no capacity/waitlist, so the "Register only" (in-advance,
  // no check-in) button doesn't make much sense there — most weeknight
  // players just walk in (BUILD-SPEC.md §6). Fri/Sat shows both actions.
  showRegisterOnly?: boolean;
}

export function WalkInRegistrationForm({ target, players, showRegisterOnly = true }: WalkInRegistrationFormProps) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<OpenPlaySkillLevel>("BEGINNER");
  const [matchedPlayerId, setMatchedPlayerId] = useState<string | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const playersByName = useMemo(() => new Map(players.map((player) => [player.name.toLowerCase(), player])), [players]);

  function handleNameChange(value: string) {
    setPlayerName(value);
    const match = playersByName.get(value.trim().toLowerCase());
    if (match) {
      setMatchedPlayerId(match.id);
      setPhone(match.phone);
      if (match.openPlaySkillLevel) {
        setSkillLevel(match.openPlaySkillLevel);
      }
    } else {
      setMatchedPlayerId(undefined);
    }
  }

  function reset() {
    setPlayerName("");
    setPhone("");
    setSkillLevel("BEGINNER");
    setMatchedPlayerId(undefined);
  }

  function submit(action: "register" | "walkin") {
    if (!playerName.trim() || !phone.trim()) {
      toast.error("Enter a name and phone number.");
      return;
    }

    startTransition(async () => {
      const base = {
        playerName: playerName.trim(),
        phone: phone.trim(),
        skillLevel,
        playerId: matchedPlayerId,
      };

      const result =
        action === "register" && "sessionId" in target
          ? await registerWalkInAction({ sessionId: target.sessionId, ...base })
          : await registerAndCheckInAction({
              ...("sessionId" in target ? { sessionId: target.sessionId } : { date: target.date }),
              ...base,
            });

      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(action === "register" ? `${playerName.trim()} registered.` : `${playerName.trim()} checked in.`);
      reset();
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a Walk-in</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          Cash paid at the desk — marked confirmed immediately. Start typing a name to find a returning
          player and prefill their details.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInName">Name</Label>
            <Input
              id="walkInName"
              list="registrable-players"
              value={playerName}
              onChange={(event) => handleNameChange(event.target.value)}
            />
            <datalist id="registrable-players">
              {players.map((player) => (
                <option key={player.id} value={player.name} />
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInPhone">Phone</Label>
            <Input id="walkInPhone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInSkill">Skill level</Label>
            <Select value={skillLevel} onValueChange={(value) => setSkillLevel(value as OpenPlaySkillLevel)}>
              <SelectTrigger id="walkInSkill" className="w-full">
                <SelectValue>{() => OPEN_PLAY_SKILL_LEVELS[skillLevel].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
                  <SelectItem key={level} value={level}>
                    {OPEN_PLAY_SKILL_LEVELS[level].label} — {OPEN_PLAY_SKILL_LEVELS[level].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" disabled={isPending} onClick={() => submit("walkin")}>
            {isPending ? "Working…" : "Walk-in (register & check in)"}
          </Button>
          {showRegisterOnly && "sessionId" in target ? (
            <Button type="button" variant="outline" disabled={isPending} onClick={() => submit("register")}>
              Register only (arriving later)
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
