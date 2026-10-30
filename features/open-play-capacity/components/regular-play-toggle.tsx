"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setRegularPlayForDateAction } from "@/actions/open-play-capacity.actions";
import { Switch } from "@/components/ui/switch";

interface RegularPlayToggleProps {
  date: string; // "YYYY-MM-DD"
  regularPlay: boolean;
}

// Owner request (2026-10-31): "change the unli play for later to regular
// play, the 35 per game". On: this Fri/Sat runs like a weeknight — ₱35
// per game on tabs, no ₱150 registration, Unliplay closed on the website.
// Off: back to Unliplay. Refused (with the reason as a toast) while anyone
// still holds a paid Unliplay seat for the night.
export function RegularPlayToggle({ date, regularPlay }: RegularPlayToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await setRegularPlayForDateAction({ date, regularPlay: checked });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(checked ? "This night is now regular play (₱35 per game)." : "This night is back to Unliplay.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={regularPlay}
        onCheckedChange={handleToggle}
        disabled={isPending}
        tone="status"
        aria-label="Regular play for this date"
      />
      <span className="text-muted-foreground text-xs">
        {regularPlay ? "Regular play (₱35 per game) instead of Unliplay" : "Switch to regular play (₱35 per game)"}
      </span>
    </div>
  );
}
