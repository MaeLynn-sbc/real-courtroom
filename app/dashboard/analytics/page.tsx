import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { KpiCard } from "@/features/analytics/components/kpi-card";
import { activityFeedService } from "@/services/activity/activity-feed.service";
import { analyticsService } from "@/services/analytics/analytics.service";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";

export const metadata: Metadata = {
  title: "Analytics",
};

interface AnalyticsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default async function AnalyticsPage({ searchParams }: AnalyticsPageProps) {
  const params = await searchParams;
  const range = resolveDateRangeFromSearchParams(params);

  const [
    courtUtilizationTrend,
    membershipGrowth,
    playerActivity,
    openPlayParticipation,
    tournamentParticipation,
    equipmentUtilization,
    lockerUtilization,
    activityFeed,
  ] = await Promise.all([
    analyticsService.getCourtUtilizationTrend(range),
    analyticsService.getMembershipGrowth(range),
    analyticsService.getPlayerActivity(range),
    analyticsService.getOpenPlayParticipation(range),
    analyticsService.getTournamentParticipation(range),
    analyticsService.getEquipmentUtilization(range),
    analyticsService.getLockerUtilization(range),
    activityFeedService.getActivityFeed({ from: range.from, to: range.to, limit: 20 }),
  ]);

  const totalBookedHours = courtUtilizationTrend.reduce((sum, point) => sum + point.value, 0);
  const totalNewMembers = membershipGrowth.reduce((sum, point) => sum + point.value, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground text-sm">Trends and participation across every module.</p>
        </div>
        <DateRangePicker />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <KpiCard label="Booked court hours" value={totalBookedHours.toFixed(1)} />
        <KpiCard label="New enrollments" value={totalNewMembers} />
        <KpiCard label="Active players" value={playerActivity.activePlayers} />
        <KpiCard label="Open Play sessions" value={openPlayParticipation.sessionsCount} />
        <KpiCard label="Open Play registrations" value={openPlayParticipation.registrationsCount} />
        <KpiCard label="Tournaments" value={tournamentParticipation.tournamentsCount} />
        <KpiCard label="Tournament registrations" value={tournamentParticipation.registrationsCount} />
        <KpiCard label="Lockers occupied" value={`${lockerUtilization.occupiedCount}/${lockerUtilization.totalLockers}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Court utilization by day</CardTitle>
          </CardHeader>
          <CardContent>
            {courtUtilizationTrend.length === 0 ? (
              <p className="text-muted-foreground text-sm">No bookings in this range.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {courtUtilizationTrend.map((point) => (
                  <li key={point.date} className="flex justify-between">
                    <span className="text-muted-foreground">{point.date}</span>
                    <span className="tabular-nums">{point.value.toFixed(1)}h</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Membership growth by day</CardTitle>
          </CardHeader>
          <CardContent>
            {membershipGrowth.length === 0 ? (
              <p className="text-muted-foreground text-sm">No enrollments in this range.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {membershipGrowth.map((point) => (
                  <li key={point.date} className="flex justify-between">
                    <span className="text-muted-foreground">{point.date}</span>
                    <span className="tabular-nums">{point.value}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment utilization</CardTitle>
          </CardHeader>
          <CardContent>
            {equipmentUtilization.length === 0 ? (
              <p className="text-muted-foreground text-sm">No rentals in this range.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {equipmentUtilization.map((row) => (
                  <li key={row.equipmentId} className="flex justify-between">
                    <span className="text-muted-foreground">{row.equipmentName}</span>
                    <span className="tabular-nums">{row.rentalsCount} rentals</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activityFeed.length === 0 ? (
              <p className="text-muted-foreground text-sm">No activity in this range.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {activityFeed.map((entry) => (
                  <li key={entry.id} className="flex flex-col">
                    <span>{entry.label}</span>
                    <span className="text-muted-foreground text-xs">
                      {entry.actorName ?? "System"} · {dateFormatter.format(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
