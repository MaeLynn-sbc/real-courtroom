import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { BookingList } from "@/features/bookings/components/booking-list";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Stale Holds",
};

export const dynamic = "force-dynamic";

// A booking now blocks its court indefinitely while AWAITING_PAYMENT —
// there's no automatic release anymore (2026-08-03, see
// booking.service.ts's checkAvailabilityWithClient comment for the
// incident that drove this). This is the deliberate other half of that
// change: a court can only stop being blocked by an explicit staff
// decision (cancel it here, or wait for the customer's proof), so staff
// need a real way to find these — a filter buried on the main bookings
// list (which is date-scoped, and these can be from any past day) isn't
// enough. Cross-date by design, oldest reservation time first (the
// default sort — see listBookings' own comment) so the longest-neglected
// ones surface at the top.
export default async function StaleHoldsPage() {
  const bookings = await bookingService.listBookings({ staleHoldsOnly: true });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stale Holds</h1>
          <p className="text-muted-foreground text-sm">
            Bookings still awaiting payment past their hold window — each one is still blocking its
            court. Cancel to free the slot, or leave it if the customer might still pay.
          </p>
        </div>
        <Link href="/dashboard/bookings" className={buttonVariants({ variant: "outline" })}>
          All bookings
        </Link>
      </div>

      {bookings.length === 0 ? (
        <EmptyState
          title="No stale holds"
          description="Every AWAITING_PAYMENT booking is still inside its hold window."
        />
      ) : (
        <BookingList bookings={bookings} />
      )}
    </div>
  );
}
