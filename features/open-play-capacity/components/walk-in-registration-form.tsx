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

export interface WalkInPaymentMethod {
  id: string;
  label: string;
}

type NightTarget = { sessionId: string } | { date: string };

interface WalkInRegistrationFormProps {
  target: NightTarget;
  players: RegistrablePlayer[];
  // Weeknight has no capacity/waitlist, so the "Register only" (in-advance,
  // no check-in) button doesn't make much sense there — most weeknight
  // players just walk in (BUILD-SPEC.md §6). Fri/Sat shows both actions.
  showRegisterOnly?: boolean;
  // Gate 2 review follow-up (BUILD-SPEC.md §9): only meaningful (and
  // only ever passed) for a Fri/Sat `target` — the ₱150 registration
  // fee applies there, never on a weeknight. Same PaymentMethod list
  // TabsPanel already receives from the same page.
  paymentMethods?: WalkInPaymentMethod[];
}

export function WalkInRegistrationForm({
  target,
  players,
  showRegisterOnly = true,
  paymentMethods = [],
}: WalkInRegistrationFormProps) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<OpenPlaySkillLevel>("BEGINNER");
  const [matchedPlayerId, setMatchedPlayerId] = useState<string | undefined>(undefined);
  const [method, setMethod] = useState<"CASH" | "GCASH">("CASH");
  const [gcashReference, setGcashReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  const isCapacityNight = "sessionId" in target;

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
    setMethod("CASH");
    setGcashReference("");
  }

  function submit(action: "register" | "walkin") {
    if (!playerName.trim() || !phone.trim()) {
      toast.error("Enter a name and phone number.");
      return;
    }
    if (isCapacityNight) {
      if (!paymentMethodId) {
        toast.error("Select a payment method.");
        return;
      }
      if (method === "GCASH" && !gcashReference.trim()) {
        toast.error("Enter the GCash reference number.");
        return;
      }
    }

    startTransition(async () => {
      const base = {
        playerName: playerName.trim(),
        phone: phone.trim(),
        skillLevel,
        playerId: matchedPlayerId,
      };

      let result: { error: string | null };
      if (action === "register" && "sessionId" in target) {
        result = await registerWalkInAction({
          sessionId: target.sessionId,
          ...base,
          method,
          gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
          paymentMethodId,
        });
      } else if ("sessionId" in target) {
        result = await registerAndCheckInAction({
          sessionId: target.sessionId,
          ...base,
          method,
          gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
          paymentMethodId,
        });
      } else {
        result = await registerAndCheckInAction({ date: target.date, ...base });
      }

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
          {isCapacityNight
            ? "Marked confirmed immediately. Start typing a name to find a returning player and prefill their details."
            : "Cash paid at the desk — marked confirmed immediately. Start typing a name to find a returning player and prefill their details."}
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
        {isCapacityNight ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed px-3 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="walkInMethod">Registration fee</Label>
              <Select value={method} onValueChange={(value) => setMethod(value as "CASH" | "GCASH")}>
                <SelectTrigger id="walkInMethod" className="w-28">
                  <SelectValue>{() => (method === "CASH" ? "Cash" : "GCash")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="GCASH">GCash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {method === "GCASH" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="walkInGcashReference">GCash reference</Label>
                <Input
                  id="walkInGcashReference"
                  className="w-48"
                  value={gcashReference}
                  onChange={(event) => setGcashReference(event.target.value)}
                />
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="walkInPaymentMethod">Payment method</Label>
              <Select value={paymentMethodId} onValueChange={(value) => setPaymentMethodId(value ?? "")}>
                <SelectTrigger id="walkInPaymentMethod" className="w-40">
                  <SelectValue>{() => paymentMethods.find((pm) => pm.id === paymentMethodId)?.label ?? "Select"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      {pm.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}
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
