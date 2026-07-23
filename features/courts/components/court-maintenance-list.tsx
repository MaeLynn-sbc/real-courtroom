"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { updateMaintenanceStatusAction } from "@/actions/court.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CourtMaintenance } from "@/lib/generated/prisma/client";
import type { MaintenanceStatus } from "@/lib/generated/prisma/enums";

const STATUS_LABELS: Record<MaintenanceStatus, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const STATUS_VARIANTS: Record<MaintenanceStatus, "success" | "outline" | "warning" | "destructive"> = {
  SCHEDULED: "outline",
  IN_PROGRESS: "warning",
  COMPLETED: "success",
  CANCELLED: "destructive",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface CourtMaintenanceListProps {
  courtId: string;
  maintenanceRecords: CourtMaintenance[];
  canManage: boolean;
}

export function CourtMaintenanceList({
  courtId,
  maintenanceRecords,
  canManage,
}: CourtMaintenanceListProps) {
  const [isPending, startTransition] = useTransition();

  function handleStatusChange(maintenanceId: string, status: MaintenanceStatus) {
    startTransition(async () => {
      const result = await updateMaintenanceStatusAction(maintenanceId, courtId, status);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Maintenance record updated.");
    });
  }

  if (maintenanceRecords.length === 0) {
    return (
      <EmptyState
        title="No maintenance scheduled"
        description="Maintenance windows for this court will appear here."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {maintenanceRecords.map((record) => (
        <li key={record.id} className="rounded-xl border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-medium">{record.reason}</p>
              <p className="text-muted-foreground text-sm">
                {dateTimeFormatter.format(record.startAt)} –{" "}
                {dateTimeFormatter.format(record.endAt)}
              </p>
              {record.notes ? (
                <p className="text-muted-foreground mt-1 text-sm">{record.notes}</p>
              ) : null}
            </div>
            <Badge variant={STATUS_VARIANTS[record.status]}>
              {STATUS_LABELS[record.status]}
            </Badge>
          </div>

          {canManage && (record.status === "SCHEDULED" || record.status === "IN_PROGRESS") ? (
            <div className="mt-3 flex gap-2">
              {record.status === "SCHEDULED" ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleStatusChange(record.id, "IN_PROGRESS")}
                >
                  Start
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => handleStatusChange(record.id, "COMPLETED")}
              >
                Mark complete
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={isPending}
                onClick={() => handleStatusChange(record.id, "CANCELLED")}
              >
                Cancel
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
