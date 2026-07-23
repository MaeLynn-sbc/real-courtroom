"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { resolveEquipmentMaintenanceAction } from "@/actions/equipment.actions";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { equipmentService } from "@/services/equipment/equipment.service";

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });

const LOG_TYPE_LABELS: Record<string, string> = {
  ROUTINE: "Routine",
  DAMAGE_REPORT: "Damage report",
  REPAIR: "Repair",
  REPLACEMENT: "Replacement",
};

type Logs = Awaited<ReturnType<typeof equipmentService.listMaintenanceLogs>>;

interface EquipmentMaintenanceLogListProps {
  equipmentId: string;
  logs: Logs;
}

export function EquipmentMaintenanceLogList({ equipmentId, logs }: EquipmentMaintenanceLogListProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleResolve(logId: string) {
    startTransition(async () => {
      const result = await resolveEquipmentMaintenanceAction(logId, equipmentId, {});
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Marked resolved.");
      router.refresh();
    });
  }

  if (logs.length === 0) {
    return <EmptyState title="No maintenance logs yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Type</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>Performed</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell>{LOG_TYPE_LABELS[log.logType] ?? log.logType}</TableCell>
            <TableCell>{log.note}</TableCell>
            <TableCell>{dateFormatter.format(log.performedAt)}</TableCell>
            <TableCell>
              <Badge variant={log.resolvedAt ? "success" : "warning"}>
                {log.resolvedAt ? "Resolved" : "Open"}
              </Badge>
            </TableCell>
            <TableCell>
              {!log.resolvedAt ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => handleResolve(log.id)}
                >
                  Resolve
                </Button>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
