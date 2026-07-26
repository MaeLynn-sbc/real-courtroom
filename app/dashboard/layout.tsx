import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Phase 8 Gate 3 (§8): "A pending-verification count badge must appear
  // on every dashboard page (not just a dedicated verification screen)."
  // Computed once per navigation here in the shared layout, not polled
  // client-side — every dashboard page already re-renders this layout,
  // so the count is never more than one navigation stale.
  const pendingVerificationCount = await bookingPaymentProofService.countPendingProofs();

  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader pendingVerificationCount={pendingVerificationCount} />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
