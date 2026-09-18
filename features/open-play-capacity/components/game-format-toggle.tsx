"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlayShortGameAction } from "@/actions/open-play-rotation.actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SHORT_GAME_MINUTES, SHORT_GAME_RATE_CENTS } from "@/lib/game-format";
import { formatCurrency } from "@/lib/utils";

// Owner (2026-09-18): switch per-game format between the regular one and
// 15 min · ₱30. The TV timer and the tab charge follow the format of each
// game at the moment it was put on a court, so flipping this mid-night
// never changes a running game.
export function GameFormatToggle({
  shortGame,
  regularMinutes,
  regularRateCents,
  unliNight = false,
}: {
  shortGame: boolean;
  regularMinutes: number;
  regularRateCents: number;
  // Fri/Sat, where the players paid the flat unlimited fee up front.
  // Owner (2026-09-18): the switch works the same on an unli night —
  // only the length changes, because an unli player's games are already
  // billed at ₱0 (player-tab.service.ts's computeGameRateCents). Said
  // out loud here so staff flipping it mid-night don't have to wonder
  // whether it starts charging the prepaid players ₱30.
  unliNight?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const shortLabel = `${SHORT_GAME_MINUTES} min · ${formatCurrency(SHORT_GAME_RATE_CENTS)}`;
  const regularLabel = `${regularMinutes} min · ${formatCurrency(regularRateCents)}`;

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await setOpenPlayShortGameAction(checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`New games are now ${checked ? shortLabel : regularLabel} per game.`);
      router.refresh();
    });
  }

  return (
    <div className="bg-card text-card-foreground flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="shortGameFormat" className="font-medium">
          Game format:{" "}
          <span className="font-semibold">{shortGame ? shortLabel : regularLabel}</span> per game
        </Label>
        <p className="text-muted-foreground text-sm">
          On: {shortLabel}. Off: {regularLabel}. Applies to games put on a court from now on — the
          TV timer and the tab charge follow each game&apos;s own format.
        </p>
        {unliNight ? (
          <p className="text-muted-foreground text-sm">
            Unli players already paid for the night — only the timer changes, their games stay ₱0 at
            either length.
          </p>
        ) : null}
      </div>
      <Switch
        id="shortGameFormat"
        aria-label={`Use ${shortLabel} per game`}
        checked={shortGame}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />
    </div>
  );
}
