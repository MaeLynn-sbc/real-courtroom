import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { EquipmentRentalList } from "@/features/equipment/components/equipment-rental-list";
import { equipmentRentalService } from "@/services/equipment/equipment-rental.service";

export const metadata: Metadata = {
  title: "Equipment Rentals",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap.
export const dynamic = "force-dynamic";

export default async function EquipmentRentalsPage() {
  const [active, overdue] = await Promise.all([
    equipmentRentalService.listRentals({ status: "ACTIVE" }),
    equipmentRentalService.listRentals({ status: "OVERDUE" }),
  ]);

  const rentals = [...overdue, ...active];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Equipment rentals</h1>
        <p className="text-muted-foreground text-sm">Everything currently checked out, overdue first.</p>
      </div>

      {rentals.length === 0 ? (
        <EmptyState title="Nothing checked out" description="Active and overdue rentals will show up here." />
      ) : (
        <EquipmentRentalList rentals={rentals} showEquipmentColumn />
      )}
    </div>
  );
}
