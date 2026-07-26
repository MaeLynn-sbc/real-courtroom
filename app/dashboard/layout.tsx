import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";
import { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Phase 8 Gate 3 (§8): "A pending-verification count badge must appear
  // on every dashboard page (not just a dedicated verification screen)."
  // Computed once per navigation here in the shared layout, not polled
  // client-side — every dashboard page already re-renders this layout,
  // so the count is never more than one navigation stale.
  // Open-play's own count is fetched and shown as its OWN badge, not
  // merged into the booking count — a single combined number would
  // link to only one of the two screens and misattribute the other.
  const [pendingVerificationCount, pendingOpenPlayVerificationCount] = await Promise.all([
    bookingPaymentProofService.countPendingProofs(),
    openPlayRegistrationPaymentProofService.countPendingProofs(),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader
        pendingVerificationCount={pendingVerificationCount}
        pendingOpenPlayVerificationCount={pendingOpenPlayVerificationCount}
      />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
