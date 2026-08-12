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
import { ShiftOverviewPanel } from "@/features/dashboard/components/shift-overview-panel";
import { TodaysRevenuePanel } from "@/features/dashboard/components/todays-revenue-panel";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { activityFeedService } from "@/services/activity/activity-feed.service";
import { analyticsService } from "@/services/analytics/analytics.service";
import { resolveDateRange, resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { courtService } from "@/services/court/court.service";
import { inventoryAlertsService } from "@/services/inventory/inventory-alerts.service";
import { saleService } from "@/services/sales/sale.service";
import { shiftService } from "@/services/shift/shift.service";
import { settingsService } from "@/services/settings/settings.service";
import { PERMISSIONS } from "@/types/permissions";
import { SYSTEM_ROLES } from "@/types/roles";

export const metadata: Metadata = {
  title: "Dashboard",
};

interface DashboardPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const [session, params, courtHours] = await Promise.all([auth(), searchParams, settingsService.getCourtHours()]);
  const range = resolveDateRangeFromSearchParams(params, courtHours.businessDateRolloverHour);
  // "Today" always means today, independent of the KPI trend range above —
  // the date-range picker controls the trend grid, not these live panels.
  const today = resolveDateRange("TODAY", undefined, undefined, courtHours.businessDateRolloverHour);

  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;
  // The Owner oversees every shift rather than clocking one in themself —
  // the panel is a cashier/reception workflow, not an Owner one.
  const showShiftPanel = Boolean(employee) && session?.user.role !== SYSTEM_ROLES.OWNER;
  // Owner request (2026-08-08): the exclusion above left Owner/Admin
  // with zero shift visibility on the dashboard at all — this is the
  // read-only oversight counterpart, gated the same way
  // /dashboard/shift's own "review every employee's shift" mode already
  // is (REPORTS_MANAGE), not a new permission.
  const canReviewShifts = hasPermission(session?.user.permissions ?? [], PERMISSIONS.REPORTS_MANAGE);

  const [kpis, todaysSales, currentShift, alerts, activityFeed, courtStatus, onDutyShifts, recentShifts] =
    await Promise.all([
      analyticsService.getDashboardKpis(range, courtHours.businessDateRolloverHour),
      saleService.getSalesSummary(today, courtHours.businessDateRolloverHour),
      employee ? shiftService.getCurrentShift(employee.id) : Promise.resolve(null),
      inventoryAlertsService.getAlerts(),
      activityFeedService.getActivityFeed({ limit: 10 }),
      courtService.getCourtStatusSnapshot(),
      canReviewShifts ? shiftService.listOpenShiftsWithEmployee() : Promise.resolve([]),
      canReviewShifts ? shiftService.listAllShiftsForReview(10) : Promise.resolve([]),
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
        {canReviewShifts ? (
          <ShiftOverviewPanel
            onDuty={onDutyShifts.map((shift) => ({
              id: shift.id,
              shiftNumber: shift.shiftNumber,
              employeeName: `${shift.employee.firstName} ${shift.employee.lastName}`,
              startedAt: shift.startedAt,
            }))}
            recentShifts={recentShifts.map((shift) => ({
              id: shift.id,
              shiftNumber: shift.shiftNumber,
              employeeName: `${shift.employee.firstName} ${shift.employee.lastName}`,
              status: shift.status,
              startedAt: shift.startedAt,
              endedAt: shift.endedAt,
              varianceCents: shift.varianceCents,
            }))}
          />
        ) : null}
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
        <div className="grid grid-cols-2 gap-3">
          <KpiCard label="Bookings" value={kpis.totalBookings} />
          <KpiCard label="Tournaments" value={kpis.tournamentsInRange} />
        </div>
      </div>
    </div>
  );
}
