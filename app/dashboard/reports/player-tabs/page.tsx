import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/features/analytics/components/date-range-picker";
import { ReportTable, type ReportTableColumn } from "@/features/reports/components/report-table";
import { formatCurrency } from "@/lib/utils";
import { resolveDateRangeFromSearchParams } from "@/services/analytics/date-range";
import { playerTabHistoryService, type PlayerTabHistoryRow } from "@/services/open-play/player-tab-history.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Player Tabs History",
};

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" });
const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

const STATUS_LABELS: Record<PlayerTabHistoryRow["status"], string> = {
  OPEN: "Open",
  SETTLED: "Settled",
  WRITTEN_OFF: "Written off",
};

const STATUS_VARIANTS: Record<PlayerTabHistoryRow["status"], "success" | "outline" | "destructive"> = {
  OPEN: "outline",
  SETTLED: "success",
  WRITTEN_OFF: "destructive",
};

// Owner request (2026-08-12): "kindly build history also of player
// tabs. daily so we will know all the details" — a real cross-day list,
// not routed through the generic /dashboard/reports/[reportType]
// switch (see that route's own report.schema.ts comment on why
// open-play data was deliberately pulled OUT of it). Falls under the
// /dashboard/reports permission prefix (lib/rbac.ts), same
// REPORTS_MANAGE gate as every other report in this section — no extra
// in-page check needed, same as [reportType]/page.tsx.
export const dynamic = "force-dynamic";

interface PlayerTabsHistoryPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function PlayerTabsHistoryPage({ searchParams }: PlayerTabsHistoryPageProps) {
  const [params, courtHours] = await Promise.all([searchParams, settingsService.getCourtHours()]);
  const range = resolveDateRangeFromSearchParams(params, courtHours.businessDateRolloverHour);
  const rows = await playerTabHistoryService.listTabsInRange(range);

  const totalCents = rows.reduce((sum, row) => (row.status === "WRITTEN_OFF" ? sum : sum + row.totalCents), 0);

  const columns: ReportTableColumn<PlayerTabHistoryRow>[] = [
    { header: "Date", render: (row) => dateFormatter.format(row.date) },
    { header: "Player", render: (row) => row.playerName },
    {
      header: "Status",
      render: (row) => <Badge variant={STATUS_VARIANTS[row.status]}>{STATUS_LABELS[row.status]}</Badge>,
    },
    { header: "Amount", render: (row) => formatCurrency(row.totalCents) },
    {
      header: "Settled via",
      render: (row) => (row.settledVia ? row.settledVia : "—"),
    },
    {
      header: "Settled by",
      render: (row) => (row.settledByName ? row.settledByName : "—"),
    },
    {
      header: "Settled at",
      render: (row) => (row.settledAt ? dateTimeFormatter.format(row.settledAt) : "—"),
    },
    {
      header: "Write-off",
      render: (row) =>
        row.status === "WRITTEN_OFF" ? (
          <span className="text-sm">
            {row.writeOffReason ?? "No reason given"}
            {row.writeOffEmployeeName ? ` — ${row.writeOffEmployeeName}` : ""}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Player Tabs History</h1>
          <p className="text-muted-foreground text-sm">
            Every Open Play tab in the selected range — settled, written off, or still open.
          </p>
        </div>
        <DateRangePicker />
      </div>

      <div className="flex flex-wrap gap-6 rounded-xl border p-4">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Tabs in range</span>
          <span className="text-lg font-semibold tabular-nums">{rows.length}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Total (excluding written off)</span>
          <span className="text-lg font-semibold tabular-nums">{formatCurrency(totalCents)}</span>
        </div>
      </div>

      <ReportTable rows={rows} columns={columns} getRowKey={(row) => row.id} />
    </div>
  );
}
