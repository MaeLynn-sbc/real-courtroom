import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MembershipHistoryList } from "@/features/memberships/components/membership-history-list";
import { MembershipStatusActions } from "@/features/memberships/components/membership-status-actions";
import { MembershipStatusBadge } from "@/features/memberships/components/membership-status-badge";
import { membershipService } from "@/services/memberships/membership.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

interface MembershipDetailPageProps {
  params: Promise<{ membershipId: string }>;
}

export async function generateMetadata({ params }: MembershipDetailPageProps): Promise<Metadata> {
  const { membershipId } = await params;
  const membership = await membershipService.getMembershipById(membershipId);
  return { title: membership?.membershipReference ?? "Membership" };
}

export default async function MembershipDetailPage({ params }: MembershipDetailPageProps) {
  const { membershipId } = await params;

  const membership = await membershipService.getMembershipById(membershipId);
  if (!membership) {
    notFound();
  }

  const plans = await membershipService.listPlans();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{membership.membershipReference}</h1>
          <p className="text-muted-foreground text-sm">
            <Link href={`/dashboard/players/${membership.playerId}`} className="hover:underline">
              {membership.player.user.name ?? membership.player.user.email}
            </Link>
            {" · "}
            {membership.membershipPlan.name} · {dateFormatter.format(membership.startDate)} –{" "}
            {dateFormatter.format(membership.endDate)}
          </p>
        </div>
        <MembershipStatusBadge status={membership.status} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Actions</h2>
        <MembershipStatusActions
          membershipId={membership.id}
          currentStatus={membership.status}
          currentPlanId={membership.membershipPlanId}
          plans={plans.map((plan) => ({ id: plan.id, name: plan.name }))}
          playerId={membership.playerId}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">History</h2>
        <MembershipHistoryList history={membership.history} />
      </section>
    </div>
  );
}
