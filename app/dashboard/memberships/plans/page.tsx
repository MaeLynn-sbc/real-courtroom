import { PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { PlanList } from "@/features/memberships/components/plan-list";
import { membershipService } from "@/services/memberships/membership.service";

export const metadata: Metadata = {
  title: "Membership Plans",
};

// See app/dashboard/bookings/new/page.tsx's comment — same static-
// prerendering trap.
export const dynamic = "force-dynamic";

export default async function MembershipPlansPage() {
  const plans = await membershipService.listPlans(true);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Membership Plans</h1>
          <p className="text-muted-foreground text-sm">Manage the available membership tiers.</p>
        </div>
        <Link href="/dashboard/memberships/plans/new" className={buttonVariants()}>
          <PlusCircle className="size-4" aria-hidden="true" />
          New plan
        </Link>
      </div>

      {plans.length === 0 ? (
        <EmptyState title="No membership plans yet" description="Create a plan to start enrolling players." />
      ) : (
        <PlanList plans={plans} />
      )}
    </div>
  );
}
