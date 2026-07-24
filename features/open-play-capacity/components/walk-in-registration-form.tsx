"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { registerWalkInAction } from "@/actions/open-play-registration.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";

export function WalkInRegistrationForm({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<OpenPlaySkillLevel>("BEGINNER");
  const [isPending, startTransition] = useTransition();

  function handleSubmit() {
    if (!playerName.trim() || !phone.trim()) {
      toast.error("Enter a name and phone number.");
      return;
    }

    startTransition(async () => {
      const result = await registerWalkInAction({ sessionId, playerName: playerName.trim(), phone: phone.trim(), skillLevel });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`${playerName.trim()} registered.`);
      setPlayerName("");
      setPhone("");
      setSkillLevel("BEGINNER");
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
          Cash paid at the desk — marked confirmed immediately. If the night is full, they&apos;re added to
          the waitlist.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInName">Name</Label>
            <Input id="walkInName" value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
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
        <Button type="button" disabled={isPending} onClick={handleSubmit} className="self-start">
          {isPending ? "Registering…" : "Register"}
        </Button>
      </CardContent>
    </Card>
  );
}
