import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MembershipStatusBadge } from "@/features/memberships/components/membership-status-badge";
import { EnrollMembershipForm } from "@/features/memberships/components/enroll-membership-form";
import { PlayerForm } from "@/features/players/components/player-form";
import { PlayerStatsDashboard } from "@/features/players/components/player-stats-dashboard";
import { PlayerTimeline } from "@/features/players/components/player-timeline";
import { MODULE_KEYS } from "@/lib/module-flags";
import { membershipService } from "@/services/memberships/membership.service";
import { playerStatisticsService } from "@/services/player/player-statistics.service";
import { playerService } from "@/services/player/player.service";
import { saleService } from "@/services/sales/sale.service";
import { settingsService } from "@/services/settings/settings.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface PlayerDetailPageProps {
  params: Promise<{ playerId: string }>;
}

export async function generateMetadata({ params }: PlayerDetailPageProps): Promise<Metadata> {
  const { playerId } = await params;
  const player = await playerService.getPlayerById(playerId);
  return { title: player?.user.name ?? player?.user.email ?? "Player" };
}

export default async function PlayerDetailPage({ params }: PlayerDetailPageProps) {
  const { playerId } = await params;

  const player = await playerService.getPlayerById(playerId);
  if (!player) {
    notFound();
  }

  const [stats, timeline, plans, paymentMethods, enabledModules] = await Promise.all([
    playerStatisticsService.getPlayerStatistics(playerId),
    playerService.getPlayerTimeline(playerId),
    membershipService.listPlans(),
    saleService.listPaymentMethods(),
    settingsService.getEnabledModules(),
  ]);
  const membershipEnabled = enabledModules[MODULE_KEYS.MEMBERSHIP];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {player.user.name ?? player.user.email}
        </h1>
        <p className="text-muted-foreground text-sm">{player.user.email}</p>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Statistics</h2>
        <PlayerStatsDashboard stats={stats} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Profile</h2>
          <PlayerForm player={player} />
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Memberships</h2>
            {player.memberships.length === 0 ? (
              <p className="text-muted-foreground text-sm">No memberships yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {player.memberships.map((membership) => (
                  <li key={membership.id} className="flex items-center justify-between rounded-xl border p-3">
                    <div className="flex flex-col">
                      <Link
                        href={`/dashboard/memberships/${membership.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {membership.membershipReference}
                      </Link>
                      <span className="text-muted-foreground text-xs">
                        {membership.membershipPlan.name} · ends {dateFormatter.format(membership.endDate)}
                      </span>
                    </div>
                    <MembershipStatusBadge status={membership.status} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">Enroll in a plan</h2>
            {membershipEnabled ? (
              <EnrollMembershipForm
                playerId={player.id}
                plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))}
                paymentMethods={paymentMethods.map((method) => ({ id: method.id, label: method.label }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                Membership enrollment is currently unavailable.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Timeline</h2>
        <PlayerTimeline events={timeline} />
      </section>
    </div>
  );
}
