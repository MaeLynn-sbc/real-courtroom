import { PlusCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { auth } from "@/auth";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { CourtList } from "@/features/courts/components/court-list";
import { hasPermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/types/permissions";
import { courtService } from "@/services/court/court.service";

export const metadata: Metadata = {
  title: "Courts",
};

export default async function CourtsPage() {
  const [session, courts] = await Promise.all([auth(), courtService.listCourts()]);
  const canManage = hasPermission(session?.user.permissions ?? [], PERMISSIONS.COURTS_MANAGE);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Courts</h1>
          <p className="text-muted-foreground text-sm">
            Manage court availability, rates, and maintenance schedules.
          </p>
        </div>
        {canManage ? (
          <Link href="/dashboard/courts/new" className={buttonVariants()}>
            <PlusCircle className="size-4" aria-hidden="true" />
            New court
          </Link>
        ) : null}
      </div>

      {courts.length === 0 ? (
        <EmptyState
          title="No courts yet"
          description="Add your first court to start managing bookings and availability."
        />
      ) : (
        <CourtList courts={courts} />
      )}
    </div>
  );
}
