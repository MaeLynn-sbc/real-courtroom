import { Lock, PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { InventoryAlertsBanner } from "@/components/shared/inventory-alerts-banner";
import { buttonVariants } from "@/components/ui/button";
import { LockerList } from "@/features/lockers/components/locker-list";
import { LockerSummaryCards } from "@/features/lockers/components/locker-summary-cards";
import { inventoryAlertsService } from "@/services/inventory/inventory-alerts.service";
import { lockerService } from "@/services/lockers/locker.service";

export const metadata: Metadata = {
  title: "Lockers",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap.
export const dynamic = "force-dynamic";

export default async function LockersPage() {
  const [lockers, summary, alerts] = await Promise.all([
    lockerService.listLockers(),
    lockerService.getInventorySummary(),
    inventoryAlertsService.getAlerts(),
  ]);

  const lockerAlerts = alerts.filter(
    (alert) => alert.type === "LOCKER_UNDER_MAINTENANCE" || alert.type === "LOCKER_EXPIRED_AWAITING_RECONCILIATION",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Lockers</h1>
          <p className="text-muted-foreground text-sm">Manage locker availability and maintenance.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/lockers/rentals" className={buttonVariants({ variant: "outline" })}>
            Active rentals
          </Link>
          <Link href="/dashboard/lockers/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New locker
          </Link>
        </div>
      </div>

      <LockerSummaryCards summary={summary} />
      <InventoryAlertsBanner alerts={lockerAlerts} />

      {lockers.length === 0 ? (
        <EmptyState icon={Lock} title="No lockers yet" description="Add a locker to start renting it out." />
      ) : (
        <LockerList lockers={lockers} />
      )}
    </div>
  );
}
