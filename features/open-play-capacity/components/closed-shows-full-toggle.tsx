"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setOpenPlayClosedShowsFullAction } from "@/actions/open-play-capacity.actions";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// "When registration is off, show FULL on the website" (owner request,
// 2026-09-11). Registration gets switched off for more than one reason,
// and very often it is simply that the night filled from walk-ins and
// regulars — but the homepage then showed nothing, which reads as
// "closed" or "broken" rather than "full".
//
// This does NOT turn registration on or off — the weekday and per-night
// switches still do that. It only decides what a switched-off night SAYS
// to the public. Same shape and pattern as OnlineRegistrationBlockToggle.
export function ClosedShowsFullToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      const result = await setOpenPlayClosedShowsFullAction(checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(
        checked
          ? "Nights with registration off now show as FULL on the website."
          : "Nights with registration off now show as closed on the website.",
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="closedShowsFull" className="font-medium">
          Show &quot;FULL&quot; when online registration is off
        </Label>
        <p className="text-muted-foreground text-sm">
          When on, a night with online registration switched off appears on the website as{" "}
          <span className="font-medium">Full</span> instead of closed, and the Join open play button
          is disabled. Genuinely full nights always show Full either way.
        </p>
      </div>
      <Switch
        id="closedShowsFull"
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={isPending}
      />
    </div>
  );
}
