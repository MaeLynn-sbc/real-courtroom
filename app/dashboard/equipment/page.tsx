import { Dumbbell, PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { InventoryAlertsBanner } from "@/components/shared/inventory-alerts-banner";
import { buttonVariants } from "@/components/ui/button";
import { EquipmentList } from "@/features/equipment/components/equipment-list";
import { EquipmentSummaryCards } from "@/features/equipment/components/equipment-summary-cards";
import { equipmentService } from "@/services/equipment/equipment.service";
import { inventoryAlertsService } from "@/services/inventory/inventory-alerts.service";

export const metadata: Metadata = {
  title: "Equipment",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap, verified across every page in this shape (list/form
// pages with no searchParams/dynamic segment/auth() call).
export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const [items, summary, alerts] = await Promise.all([
    equipmentService.listEquipment(),
    equipmentService.getInventorySummary(),
    inventoryAlertsService.getAlerts(),
  ]);

  const equipmentAlerts = alerts.filter(
    (alert) => alert.type === "LOW_STOCK" || alert.type === "UNRESOLVED_DAMAGE" || alert.type === "OVERDUE_EQUIPMENT_RENTAL",
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Equipment</h1>
          <p className="text-muted-foreground text-sm">
            Manage the rental inventory, availability, and maintenance.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/equipment/rentals" className={buttonVariants({ variant: "outline" })}>
            Active rentals
          </Link>
          <Link href="/dashboard/equipment/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New equipment
          </Link>
        </div>
      </div>

      <EquipmentSummaryCards summary={summary} />
      <InventoryAlertsBanner alerts={equipmentAlerts} />

      {items.length === 0 ? (
        <EmptyState icon={Dumbbell} title="No equipment yet" description="Add equipment to start renting it out." />
      ) : (
        <EquipmentList items={items} />
      )}
    </div>
  );
}
