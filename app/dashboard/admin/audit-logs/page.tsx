import type { Metadata } from "next";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { activityFeedService } from "@/services/activity/activity-feed.service";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";

export const metadata: Metadata = {
  title: "Audit Logs",
};

interface AuditLogsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default async function AuditLogsPage({ searchParams }: AuditLogsPageProps) {
  const params = await searchParams;
  const range = resolveDateRangeFromSearchParams(params);

  const entries = await activityFeedService.getActivityFeed({
    from: range.from,
    to: range.to,
    limit: 200,
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit logs</h1>
          <p className="text-muted-foreground text-sm">
            Every recorded action across the system, most recent first.
          </p>
        </div>
        <DateRangePicker />
      </div>

      {entries.length === 0 ? (
        <EmptyState title="No activity in this date range." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="font-medium">{entry.label}</TableCell>
                <TableCell>
                  <Badge variant="outline">{entry.entityTypeLabel}</Badge>
                </TableCell>
                <TableCell>{entry.actorName ?? "System"}</TableCell>
                <TableCell className="whitespace-nowrap">{dateTimeFormatter.format(entry.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
