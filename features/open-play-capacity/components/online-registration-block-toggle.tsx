"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setOnlineRegistrationBlockedForDateAction } from "@/actions/open-play-capacity.actions";
import { Switch } from "@/components/ui/switch";

interface OnlineRegistrationBlockToggleProps {
  date: string; // "YYYY-MM-DD"
  blocked: boolean;
}

// Date-specific override, independent of both the feature-wide switch
// (elsewhere) and the day-of-week default (CapacityDefaultsPanel) —
// "this particular Friday is a tournament, no online registration that
// night" even though Fridays are normally open. Live-toggled, same
// tone="status" convention as every other live/persisted settings
// toggle in the dashboard (BUILD-SPEC.md §2).
export function OnlineRegistrationBlockToggle({ date, blocked }: OnlineRegistrationBlockToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    // Switch reads "checked" as "online registration allowed" (the
    // normal state), so blocked = !checked.
    const nextBlocked = !checked;
    startTransition(async () => {
      const result = await setOnlineRegistrationBlockedForDateAction({ date, blocked: nextBlocked });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(nextBlocked ? "Online registration blocked for this date." : "Online registration re-enabled for this date.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={!blocked}
        onCheckedChange={handleToggle}
        disabled={isPending}
        tone="status"
        aria-label="Online registration for this date"
      />
      <span className="text-muted-foreground text-xs">
        Online registration {blocked ? "blocked for this date" : "open for this date"}
      </span>
    </div>
  );
}
