import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { membershipService } from "@/services/memberships/membership.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

const EVENT_LABELS: Record<string, string> = {
  ENROLLED: "Enrolled",
  RENEWED: "Renewed",
  UPGRADED: "Upgraded",
  DOWNGRADED: "Downgraded",
  SUSPENDED: "Suspended",
  REACTIVATED: "Reactivated",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};

type History = Awaited<ReturnType<typeof membershipService.getMembershipHistory>>;

export function MembershipHistoryList({ history }: { history: History }) {
  if (history.length === 0) {
    return <EmptyState title="No history yet." />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Event</TableHead>
          <TableHead>Plan</TableHead>
          <TableHead>Note</TableHead>
          <TableHead>By</TableHead>
          <TableHead>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {history.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell className="font-medium">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</TableCell>
            <TableCell>{entry.membershipPlan?.name ?? "—"}</TableCell>
            <TableCell>{entry.note ?? "—"}</TableCell>
            <TableCell>{entry.changedBy?.name ?? "System"}</TableCell>
            <TableCell>{dateTimeFormatter.format(entry.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
