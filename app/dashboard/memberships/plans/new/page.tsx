import type { Metadata } from "next";

import { PlanForm } from "@/features/memberships/components/plan-form";

export const metadata: Metadata = {
  title: "New Membership Plan",
};

export default function NewMembershipPlanPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New membership plan</h1>
        <p className="text-muted-foreground text-sm">Set the price, billing period, and perks.</p>
      </div>
      <PlanForm />
    </div>
  );
}
