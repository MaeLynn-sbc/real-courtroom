"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setEquipmentHideLowStockAlertAction } from "@/actions/equipment.actions";
import { Switch } from "@/components/ui/switch";

interface LowStockAlertToggleProps {
  hidden: boolean;
}

// Page-local display preference, not a system-wide setting — hides just
// the LOW_STOCK alert type from this page's own banner (see
// inventory-alerts.service.ts's fixed threshold, which flags a fully-
// available 2-of-2-owned item the same as a genuinely depleted one).
// Damage/overdue-rental alerts are unaffected and keep showing
// regardless of this toggle. Same live-toggle, tone="status" convention
// as every other persisted settings switch in the dashboard.
export function LowStockAlertToggle({ hidden }: LowStockAlertToggleProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    // Switch reads "checked" as "alert shown" (the normal state), so
    // hidden = !checked.
    const nextHidden = !checked;
    startTransition(async () => {
      const result = await setEquipmentHideLowStockAlertAction(nextHidden);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(nextHidden ? "Low-stock alerts hidden on this page." : "Low-stock alerts shown again.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Switch
        checked={!hidden}
        onCheckedChange={handleToggle}
        disabled={isPending}
        tone="status"
        aria-label="Low-stock alerts"
      />
      <span className="text-muted-foreground text-xs">
        Low-stock alerts {hidden ? "hidden on this page" : "shown"}
      </span>
    </div>
  );
}
