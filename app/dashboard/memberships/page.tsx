import { CreditCard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { MembershipList } from "@/features/memberships/components/membership-list";
import type { MembershipStatus } from "@/lib/generated/prisma/enums";
import { membershipService } from "@/services/memberships/membership.service";

export const metadata: Metadata = {
  title: "Memberships",
};

const STATUS_FILTER_OPTIONS: { value: MembershipStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "ACTIVE", label: "Active" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface MembershipsPageProps {
  searchParams: Promise<{ status?: string }>;
}

export default async function MembershipsPage({ searchParams }: MembershipsPageProps) {
  const { status: statusParam } = await searchParams;
  const status = STATUS_FILTER_OPTIONS.some((option) => option.value === statusParam)
    ? (statusParam as MembershipStatus)
    : undefined;

  const memberships = await membershipService.listMemberships({ status });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memberships</h1>
          <p className="text-muted-foreground text-sm">
            Track enrollments, renewals, and expirations across all players.
          </p>
        </div>
        <Link href="/dashboard/memberships/plans" className={buttonVariants({ variant: "outline" })}>
          Manage plans
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={status ?? ""}
            className="border-input h-8 rounded-lg border bg-transparent px-2.5 text-sm"
          >
            <option value="">All</option>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="border-input hover:bg-muted h-8 rounded-lg border px-3 text-sm font-medium"
        >
          Filter
        </button>
      </form>

      {memberships.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No memberships for this filter"
          description="Enroll a player from their profile page, or adjust the status filter above."
        />
      ) : (
        <MembershipList memberships={memberships} />
      )}
    </div>
  );
}
