"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setThirdPlaceMatchAction } from "@/actions/tournament.actions";
import { Switch } from "@/components/ui/switch";

interface ThirdPlaceMatchToggleProps {
  tournamentId: string;
  categoryId: string;
  hasThirdPlaceMatch: boolean;
}

// Owner request (2026-08-17), against a reference bracket showing a
// "BRONZE" slot beside the final: a third-place playoff between the two
// semifinal losers. Opt-in per category, since plenty of categories here
// simply finish at the final.
//
// Turning it on AFTER the semis are decided creates the match
// retroactively (matchService.setThirdPlaceMatch) — that's the common
// case, because the decision to play for third usually gets made once the
// semis are over. Same live-toggled, tone="status" convention as
// TournamentPaymentSettingToggle.
export function ThirdPlaceMatchToggle({
  tournamentId,
  categoryId,
  hasThirdPlaceMatch,
}: ThirdPlaceMatchToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await setThirdPlaceMatchAction(tournamentId, categoryId, { enabled: checked });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        checked
          ? "Third-place match on — it appears beside the final once both semifinals are decided."
          : "Third-place match off.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={hasThirdPlaceMatch}
        onCheckedChange={handleToggle}
        disabled={isPending}
        tone="status"
        aria-label="Play a third-place match"
      />
      <span className="text-muted-foreground text-xs">
        {hasThirdPlaceMatch
          ? "Third-place match (bronze) between the two semifinal losers"
          : "No third-place match — this category ends at the final"}
      </span>
    </div>
  );
}
