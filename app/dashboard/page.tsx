import { CalendarPlus, QrCode } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { InventoryAlertsBanner } from "@/components/shared/inventory-alerts-banner";
import { buttonVariants } from "@/components/ui/button";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { KpiCard } from "@/features/analytics/components/kpi-card";
import { CourtStatusPanel } from "@/features/dashboard/components/court-status-panel";
import { MyShiftPanel } from "@/features/dashboard/components/my-shift-panel";
import { QuickActionsPanel } from "@/features/dashboard/components/quick-actions-panel";
import { RecentActivityPanel } from "@/features/dashboard/components/recent-activity-panel";
import { TodaysRevenuePanel } from "@/features/dashboard/components/todays-revenue-panel";
import { formatCurrency } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { activityFeedService } from "@/services/activity/activity-feed.service";
import { analyticsService } from "@/services/analytics/analytics.service";
import { resolveDateRange, resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { courtService } from "@/services/court/court.service";
import { inventoryAlertsService } from "@/services/inventory/inventory-alerts.service";
import { saleService } from "@/services/sales/sale.service";
import { shiftService } from "@/services/shift/shift.service";
import { SYSTEM_ROLES } from "@/types/roles";

export const metadata: Metadata = {
  title: "Dashboard",
};

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [session, params] = await Promise.all([auth(), searchParams]);
  const range = resolveDateRangeFromSearchParams(params);
  // "Today" always means today, independent of the KPI trend range above —
  // the date-range picker controls the trend grid, not these live panels.
  const today = resolveDateRange("TODAY");

  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;
  // The Owner oversees every shift rather than clocking one in themself —
  // the panel is a cashier/reception workflow, not an Owner one.
  const showShiftPanel = Boolean(employee) && session?.user.role !== SYSTEM_ROLES.OWNER;

  const [kpis, todaysSales, currentShift, alerts, activityFeed, courtStatus] = await Promise.all([
    analyticsService.getDashboardKpis(range),
    saleService.getSalesSummary(today),
    employee ? shiftService.getCurrentShift(employee.id) : Promise.resolve(null),
    inventoryAlertsService.getAlerts(),
    activityFeedService.getActivityFeed({ limit: 10 }),
    courtService.getCourtStatusSnapshot(),
  ]);

  const shiftSales = currentShift ? await saleService.getSalesForShift(currentShift.id) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome{session?.user.name ? `, ${session.user.name}` : ""}
          </h1>
          <p className="text-muted-foreground text-sm">
            You&apos;re signed in as {session?.user.role ?? "a member"}.
          </p>
        </div>
        {/* Same two links as QuickActionsPanel's own QUICK_ACTIONS list
            below — duplicated here, not moved, so both the always-
            visible header shortcut and the fuller Quick actions card
            keep working. Placed between the welcome block and the date
            picker per the owner's own ask for easier access. */}
        <div className="flex gap-2">
          <Link href="/dashboard/bookings/new" className={buttonVariants()}>
            <CalendarPlus className="size-4" aria-hidden="true" />
            New booking
          </Link>
          <Link href="/dashboard/bookings/check-in" className={buttonVariants({ variant: "outline" })}>
            <QrCode className="size-4" aria-hidden="true" />
            Check in
          </Link>
        </div>
        <DateRangePicker />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {showShiftPanel ? <MyShiftPanel shift={currentShift} sales={shiftSales} /> : null}
        <TodaysRevenuePanel summary={todaysSales} />
        {alerts.length > 0 ? (
          <div className="lg:col-span-2">
            <InventoryAlertsBanner alerts={alerts} />
          </div>
        ) : null}
        <CourtStatusPanel courts={courtStatus} />
        <QuickActionsPanel />
        <RecentActivityPanel entries={activityFeed} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-medium">Trends</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Bookings" value={kpis.totalBookings} />
          <KpiCard label="Billable amount" value={formatCurrency(kpis.billableAmountCents)} />
          <KpiCard label="Active memberships" value={kpis.activeMemberships} />
          <KpiCard label="New enrollments" value={kpis.newEnrollments} />
          <KpiCard label="Open Play sessions (Fri/Sat)" value={kpis.openPlaySessions} />
          <KpiCard label="Tournaments" value={kpis.tournamentsInRange} />
          <KpiCard label="Active equipment rentals" value={kpis.equipmentRentalsActive} />
          <KpiCard label="Lockers occupied" value={kpis.lockersOccupied} />
          <KpiCard label="Unresolved alerts" value={kpis.unresolvedAlerts} />
        </div>
      </div>
    </div>
  );
}
