"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { updateTournamentPaymentSettingAction } from "@/actions/tournament.actions";
import { Switch } from "@/components/ui/switch";

interface TournamentPaymentSettingToggleProps {
  tournamentId: string;
  collectsPaymentOnSite: boolean;
}

// Owner request (2026-08-05): some tournaments run as an outside event
// where entrants already paid the organizers directly — registering a
// team there shouldn't require an open shift or record a Sale. Same
// live-toggled, tone="status" convention as every other persisted
// settings switch in the dashboard (see
// OnlineRegistrationBlockToggle's own comment).
export function TournamentPaymentSettingToggle({
  tournamentId,
  collectsPaymentOnSite,
}: TournamentPaymentSettingToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await updateTournamentPaymentSettingAction(tournamentId, {
        collectsPaymentOnSite: checked,
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        checked
          ? "Payment will be collected here when registering teams."
          : "Payment won't be collected here — registering a team no longer needs a shift or payment method.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={collectsPaymentOnSite}
        onCheckedChange={handleToggle}
        disabled={isPending}
        tone="status"
        aria-label="Collect payment when registering teams"
      />
      <span className="text-muted-foreground text-xs">
        {collectsPaymentOnSite
          ? "Collecting payment here when registering teams"
          : "Not collecting payment here — entrants already paid the organizers"}
      </span>
    </div>
  );
}
