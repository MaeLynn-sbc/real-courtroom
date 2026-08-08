"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { cancelSpecialEventAction } from "@/actions/court.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface SpecialEventRow {
  id: string;
  courtName: string;
  reason: string;
  notes: string | null;
  startAt: Date;
  endAt: Date;
  status: string;
}

interface SpecialEventListProps {
  events: SpecialEventRow[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

const STATUS_VARIANT: Record<string, "status" | "outline" | "destructive"> = {
  SCHEDULED: "status",
  IN_PROGRESS: "status",
  COMPLETED: "outline",
  CANCELLED: "destructive",
};

function CancelButton({ maintenanceId }: { maintenanceId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const result = await cancelSpecialEventAction(maintenanceId);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success("Event block cancelled.");
          router.refresh();
        });
      }}
    >
      {isPending ? "Cancelling…" : "Cancel"}
    </Button>
  );
}

export function SpecialEventList({ events }: SpecialEventListProps) {
  if (events.length === 0) {
    return <p className="text-muted-foreground text-sm">No special events scheduled.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Court</TableHead>
          <TableHead>Starts</TableHead>
          <TableHead>Ends</TableHead>
          <TableHead>Status</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.map((event) => (
          <TableRow key={event.id}>
            <TableCell className="font-medium">
              {event.reason}
              {event.notes ? (
                <p className="text-muted-foreground text-xs font-normal">{event.notes}</p>
              ) : null}
            </TableCell>
            <TableCell>{event.courtName}</TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {dateTimeFormatter.format(event.startAt)}
            </TableCell>
            <TableCell className="text-muted-foreground text-sm">
              {dateTimeFormatter.format(event.endAt)}
            </TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[event.status] ?? "outline"}>
                {event.status.replace("_", " ")}
              </Badge>
            </TableCell>
            <TableCell>
              {event.status === "SCHEDULED" || event.status === "IN_PROGRESS" ? (
                <CancelButton maintenanceId={event.id} />
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
