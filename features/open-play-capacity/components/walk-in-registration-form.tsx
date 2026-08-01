"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { registerAndCheckInAction } from "@/actions/open-play-checkin.actions";
import { registerWalkInAction } from "@/actions/open-play-registration.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  deriveSettlementMethod,
  SettlementPaymentFields,
} from "@/components/shared/settlement-payment-fields";
import { PlayerSearchCombobox } from "@/features/players/components/player-search-combobox";
import {
  OPEN_PLAY_SKILL_LEVEL_ORDER,
  OPEN_PLAY_SKILL_LEVELS,
} from "@/types/open-play-skill-levels";
import type { OpenPlaySkillLevel } from "@/lib/generated/prisma/enums";
import { cn, formatCurrency } from "@/lib/utils";
import type { SettlementPaymentMethodOption } from "@/lib/settlement-payment-methods";

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
  // Gate 2 review follow-up (BUILD-SPEC.md §9): only meaningful (and
  // only ever passed) for a Fri/Sat `target` — the ₱150 registration
  // fee applies there, never on a weeknight. Same PaymentMethod list
  // TabsPanel already receives from the same page.
  paymentMethods?: SettlementPaymentMethodOption[];
  // Live, owner-editable amounts (settingsService.getOpenPlaySettings())
  // — reported live: staff had no clear way to tell which mode this
  // form was in on a Fri/Sat date before Open Play's own cutoff, short
  // of noticing the price buried further down. Read here, not
  // hardcoded, so the mode badge below can never go stale if an owner
  // changes either rate; optional only so existing/test call sites that
  // don't care about the badge's exact wording don't have to supply
  // them.
  weeknightGameRateCents?: number;
  friSatRegistrationFeeCents?: number;
  // URGENT (reported live): before the Fri/Sat cutoff, the page now
  // renders BOTH this form (regular, target={date}) and a second instance
  // (unlimited, target={sessionId}) side by side — a customer wanting to
  // prepay for tonight's session during the afternoon had no path to do
  // that at all, since only one form used to render, chosen by the
  // cutoff. Same generic "Register a Walk-in" title on both was fine when
  // only one was ever visible at once; now that both can show together,
  // an explicit title keeps them from reading as duplicates. Defaults to
  // the original title so every other call site is unaffected.
  title?: string;
}

export function WalkInRegistrationForm({
  target,
  players,
  showRegisterOnly = true,
  paymentMethods = [],
  weeknightGameRateCents,
  friSatRegistrationFeeCents,
  title = "Register a Walk-in",
}: WalkInRegistrationFormProps) {
  const router = useRouter();
  const [playerName, setPlayerName] = useState("");
  const [phone, setPhone] = useState("");
  const [skillLevel, setSkillLevel] = useState<OpenPlaySkillLevel>("BEGINNER");
  const [matchedPlayerId, setMatchedPlayerId] = useState<string | undefined>(undefined);
  const [gcashReference, setGcashReference] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [isPending, startTransition] = useTransition();

  const isCapacityNight = "sessionId" in target;

  // Search-as-you-type combobox (shared with New Booking's "Player"
  // field) needs a `label` per option — reuse `name` rather than
  // changing the RegistrablePlayer contract every caller already
  // supplies.
  const comboboxPlayers = useMemo(
    () => players.map((player) => ({ ...player, label: player.name })),
    [players],
  );

  function handleSelectPlayer(player: RegistrablePlayer): void {
    setPlayerName(player.name);
    setMatchedPlayerId(player.id);
    setPhone(player.phone);
    if (player.openPlaySkillLevel) {
      setSkillLevel(player.openPlaySkillLevel);
    }
  }

  function handleNameChange(value: string) {
    // Any edit invalidates a prior match — phone/skill level are left
    // as they are (independently editable fields, not derived), so a
    // staff member correcting a typo doesn't lose what they've already
    // typed elsewhere.
    setPlayerName(value);
    setMatchedPlayerId(undefined);
  }

  function reset() {
    setPlayerName("");
    setPhone("");
    setSkillLevel("BEGINNER");
    setMatchedPlayerId(undefined);
    setGcashReference("");
  }

  function submit(action: "register" | "walkin") {
    if (!playerName.trim() || !phone.trim()) {
      toast.error("Enter a name and phone number.");
      return;
    }
    const method = deriveSettlementMethod(paymentMethods, paymentMethodId);
    if (isCapacityNight) {
      if (!method) {
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

      // isCapacityNight ("sessionId" in target) already returned early
      // above unless method is set — non-null here by construction.
      let result: { error: string | null; waitlisted?: boolean };
      if (action === "register" && "sessionId" in target) {
        result = await registerWalkInAction({
          sessionId: target.sessionId,
          ...base,
          method: method!,
          gcashReference: method === "GCASH" ? gcashReference.trim() : undefined,
          paymentMethodId,
        });
      } else if ("sessionId" in target) {
        result = await registerAndCheckInAction({
          sessionId: target.sessionId,
          ...base,
          method: method!,
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
      // Owner decision (Fri/Sat waitlist rework): a "walk-in" submission
      // that landed on the waiting roster (capacity full) was never
      // checked in — there's no seat to check into — so it needs its
      // own message, not the normal "checked in" one.
      const message =
        action === "register"
          ? `${playerName.trim()} registered.`
          : result.waitlisted
            ? `${playerName.trim()} added to the waiting roster — no charge.`
            : `${playerName.trim()} checked in.`;
      toast.success(message);
      reset();
      router.refresh();
    });
  }

  return (
    <Card className={cn(isCapacityNight && "border-warning/40")}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {title}
          {/* Reported live: Fri/Sat walk-ins before Open Play's own
              cutoff were being registered into the P150 unlimited
              capacity system by mistake — staff had no way to tell
              which mode this form was in short of noticing the price
              buried further down. This badge is the one thing that
              can't be missed moving fast on a money path; isCapacityNight
              (derived from `target`'s own shape) is exactly what decides
              which underlying registration action gets called below, so
              this can never drift out of sync with the form's actual
              behavior. */}
          <Badge variant={isCapacityNight ? "warning" : "status"}>
            {isCapacityNight
              ? `Unlimited night${friSatRegistrationFeeCents != null ? ` · ${formatCurrency(friSatRegistrationFeeCents)}` : ""}`
              : `Regular${weeknightGameRateCents != null ? ` · ${formatCurrency(weeknightGameRateCents)}/game` : ""}`}
          </Badge>
        </CardTitle>
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
            <PlayerSearchCombobox
              id="walkInName"
              players={comboboxPlayers}
              selectedPlayerId={matchedPlayerId ?? null}
              text={playerName}
              onSelectPlayer={handleSelectPlayer}
              onTextChange={handleNameChange}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInPhone">Phone</Label>
            <Input
              id="walkInPhone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="walkInSkill">Skill level</Label>
            <Select
              value={skillLevel}
              onValueChange={(value) => setSkillLevel(value as OpenPlaySkillLevel)}
            >
              <SelectTrigger id="walkInSkill" className="w-full">
                <SelectValue>{() => OPEN_PLAY_SKILL_LEVELS[skillLevel].label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
                  <SelectItem key={level} value={level}>
                    {OPEN_PLAY_SKILL_LEVELS[level].label} —{" "}
                    {OPEN_PLAY_SKILL_LEVELS[level].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {isCapacityNight ? (
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-dashed px-3 py-2">
            <SettlementPaymentFields
              paymentMethods={paymentMethods}
              paymentMethodId={paymentMethodId}
              onPaymentMethodIdChange={setPaymentMethodId}
              gcashReference={gcashReference}
              onGcashReferenceChange={setGcashReference}
              idPrefix="walkInPaymentMethod"
            />
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button type="button" disabled={isPending} onClick={() => submit("walkin")}>
            {isPending ? "Working…" : "Walk-in (register & check in)"}
          </Button>
          {showRegisterOnly && "sessionId" in target ? (
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => submit("register")}
            >
              Register only (arriving later)
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
