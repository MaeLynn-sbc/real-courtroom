import { AlertTriangle } from "lucide-react";

import type { InventoryAlert } from "@/services/inventory/inventory-alerts.service";

// Shared between the Equipment and Locker main pages — both render the
// same generic InventoryAlert[] computed by inventory-alerts.service.ts.
export function InventoryAlertsBanner({ alerts }: { alerts: InventoryAlert[] }) {
  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="text-amber-600 size-4" aria-hidden="true" />
        {alerts.length} alert{alerts.length === 1 ? "" : "s"} need attention
      </div>
      <ul className="flex flex-col gap-1">
        {alerts.map((alert, index) => (
          <li key={index} className="text-sm">
            <span className="font-medium">{alert.title}</span>
            {alert.description ? (
              <span className="text-muted-foreground"> — {alert.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
