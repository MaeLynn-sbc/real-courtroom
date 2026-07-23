import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { CourtForm } from "@/features/courts/components/court-form";
import { CourtMaintenanceList } from "@/features/courts/components/court-maintenance-list";
import { CourtStatusBadge } from "@/features/courts/components/court-status-badge";
import { CourtStatusControls } from "@/features/courts/components/court-status-controls";
import { ScheduleMaintenanceSheet } from "@/features/courts/components/schedule-maintenance-sheet";
import type { CourtAvailability } from "@/services/court/court.service";
import { hasPermission } from "@/lib/rbac";
import { formatCurrency } from "@/lib/utils";
import { courtService } from "@/services/court/court.service";
import { PERMISSIONS } from "@/types/permissions";

const AVAILABILITY_LABELS: Record<CourtAvailability, string> = {
  AVAILABLE: "Available now",
  UNDER_MAINTENANCE: "Under maintenance",
  DISABLED: "Disabled",
};

interface CourtDetailPageProps {
  params: Promise<{ courtId: string }>;
}

export async function generateMetadata({ params }: CourtDetailPageProps): Promise<Metadata> {
  const { courtId } = await params;
  const court = await courtService.getCourtById(courtId);
  return { title: court?.name ?? "Court" };
}

export default async function CourtDetailPage({ params }: CourtDetailPageProps) {
  const { courtId } = await params;

  const [session, court] = await Promise.all([auth(), courtService.getCourtById(courtId)]);

  if (!court) {
    notFound();
  }

  const canManage = hasPermission(session?.user.permissions ?? [], PERMISSIONS.COURTS_MANAGE);
  const availability = await courtService.getCurrentAvailability(court.id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{court.name}</h1>
          <p className="text-muted-foreground text-sm">
            {court.indoor ? "Indoor" : "Outdoor"} ·{" "}
            {court.hourlyRateCents != null
              ? `${formatCurrency(court.hourlyRateCents)}/hr`
              : "No rate set"}
          </p>
          {court.description ? <p className="mt-2 text-sm">{court.description}</p> : null}
        </div>
        <div className="flex flex-col items-end gap-2">
          <CourtStatusBadge status={court.status} />
          <span className="text-muted-foreground text-sm">
            {AVAILABILITY_LABELS[availability]}
          </span>
        </div>
      </div>

      {canManage ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Edit court</h2>
          <CourtForm court={court} />
          <CourtStatusControls court={court} />
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-lg font-medium">Maintenance</h2>
          {canManage ? <ScheduleMaintenanceSheet courtId={court.id} /> : null}
        </div>
        <CourtMaintenanceList
          courtId={court.id}
          maintenanceRecords={court.maintenanceRecords}
          canManage={canManage}
        />
      </section>
    </div>
  );
}
