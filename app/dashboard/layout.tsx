import { auth } from "@/auth";
import { DashboardHeader } from "@/components/layout/dashboard-header";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar";
import { StaleHoldsBanner } from "@/features/dashboard/components/stale-holds-banner";
import { VerificationBanner } from "@/features/dashboard/components/verification-banner";
import { hasPermission } from "@/lib/rbac";
import { bookingPaymentProofService } from "@/services/booking/booking-payment-proof.service";
import { bookingService } from "@/services/booking/booking.service";
import { openPlayRegistrationPaymentProofService } from "@/services/open-play/open-play-registration-payment-proof.service";
import { shiftService } from "@/services/shift/shift.service";
import { PERMISSIONS } from "@/types/permissions";

// Every /dashboard/* route is behind middleware.ts's own auth gate
// (matcher: ["/dashboard/:path*"]) — a statically prerendered page here
// is unreachable by construction (a signed-out build-time render could
// never be served to anyone; middleware redirects to /login first), so
// there is no upside to static generation anywhere under this layout,
// only the downside below. This layout queries the database directly
// (the pending-verification counts) with no dynamic-API usage of its
// own to force Next off the static path, so `next build` was free to
// prerender any child page that also looked static on its own (found
// live: /dashboard/admin/open-play-capacity/today and 8 other pages) —
// meaning the build depended on live database connectivity, and failed
// outright against a database it couldn't open a TLS connection to.
// Forcing dynamic here, once, covers every current and future page
// under /dashboard without relying on each one remembering its own
// per-page opt-out.
export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // Phase 8 Gate 3 (§8): "A pending-verification count badge must appear
  // on every dashboard page (not just a dedicated verification screen)."
  // Computed once per navigation here in the shared layout, not polled
  // client-side — every dashboard page already re-renders this layout,
  // so the count is never more than one navigation stale.
  // Open-play's own count is fetched and shown as its OWN badge, not
  // merged into the booking count — a single combined number would
  // link to only one of the two screens and misattribute the other.
  // Who's on duty: gated on SYSTEM_ADMIN, not DASHBOARD_ACCESS (every
  // role holds that one) — the owner wants to see who's at the desk,
  // staff don't need to. Held by Owner and Manager only. Fetched here,
  // not inside DashboardHeader, so a session without the permission
  // never even queries open shifts — onDutyEmployees is null (not an
  // empty array) specifically to distinguish "not permitted, hide the
  // indicator" from "permitted, nobody's clocked in right now."
  const session = await auth();
  const canViewOnDuty = hasPermission(session?.user.permissions ?? [], PERMISSIONS.SYSTEM_ADMIN);

  const [
    pendingVerificationCount,
    pendingOpenPlayVerificationCount,
    staleHoldsCount,
    onDutyShifts,
  ] = await Promise.all([
    bookingPaymentProofService.countPendingProofs(),
    openPlayRegistrationPaymentProofService.countPendingProofs(),
    bookingService.countStaleHolds(),
    canViewOnDuty ? shiftService.listOpenShiftsWithEmployee() : Promise.resolve(null),
  ]);

  return (
    <div className="flex min-h-svh flex-col">
      <DashboardHeader
        pendingVerificationCount={pendingVerificationCount}
        pendingOpenPlayVerificationCount={pendingOpenPlayVerificationCount}
        onDutyShifts={onDutyShifts}
      />
      <div className="flex flex-1">
        <DashboardSidebar />
        <main className="flex-1 p-4 md:p-6">
          <VerificationBanner initialCount={pendingVerificationCount} />
          <StaleHoldsBanner initialCount={staleHoldsCount} />
          {children}
        </main>
      </div>
    </div>
  );
}
