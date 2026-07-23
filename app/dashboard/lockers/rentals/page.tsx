import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { LockerRentalList } from "@/features/lockers/components/locker-rental-list";
import { lockerRentalService } from "@/services/lockers/locker-rental.service";

export const metadata: Metadata = {
  title: "Locker Rentals",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap.
export const dynamic = "force-dynamic";

export default async function LockerRentalsPage() {
  const rentals = await lockerRentalService.listRentals({ status: "ACTIVE" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Locker rentals</h1>
        <p className="text-muted-foreground text-sm">Everything currently rented out.</p>
      </div>

      {rentals.length === 0 ? (
        <EmptyState title="No active rentals" description="Active locker rentals will show up here." />
      ) : (
        <LockerRentalList rentals={rentals} showLockerColumn />
      )}
    </div>
  );
}
