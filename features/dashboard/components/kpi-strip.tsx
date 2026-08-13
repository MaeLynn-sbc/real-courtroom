import { Banknote, MapPin, UserCheck, Wallet } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn, formatCurrency, formatVariance } from "@/lib/utils";

interface RecentShiftForVariance {
  status: string;
  varianceCents: number | null;
}

interface KpiStripProps {
  revenueTodayCents: number;
  courtsInUse: number;
  courtsTotal: number;
  // null = viewer doesn't hold the permission that unlocks shift oversight
  // (matches ShiftOverviewPanel's own REPORTS_MANAGE gate) — the two
  // shift-derived cards are omitted entirely for them, not shown empty.
  onDuty: { employeeName: string }[] | null;
  recentShifts: RecentShiftForVariance[] | null;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
  detail,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  tone: "success" | "court-blue" | "sky" | "destructive" | "neutral";
  detail?: string;
}) {
  return (
    <Card className="flex-row items-center gap-3 p-4">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          tone === "success" && "bg-success/15 text-success",
          tone === "court-blue" && "bg-court-blue/15 text-court-blue",
          tone === "sky" && "bg-sky-500/15 text-sky-600",
          tone === "destructive" && "bg-destructive/15 text-destructive",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-muted-foreground text-[10px] font-bold tracking-[0.12em] uppercase">{label}</p>
        <p className="truncate text-lg font-semibold tracking-tight tabular-nums">{value}</p>
        {detail ? <p className="text-muted-foreground truncate text-xs">{detail}</p> : null}
      </div>
    </Card>
  );
}

export function KpiStrip({ revenueTodayCents, courtsInUse, courtsTotal, onDuty, recentShifts }: KpiStripProps) {
  const latestClosedShift = recentShifts?.find((shift) => shift.status !== "OPEN") ?? null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard icon={Banknote} label="Revenue today" value={formatCurrency(revenueTodayCents)} tone="success" />
      <KpiCard
        icon={MapPin}
        label="Courts in use"
        value={`${courtsInUse} / ${courtsTotal}`}
        tone="court-blue"
      />
      {onDuty ? (
        <KpiCard
          icon={UserCheck}
          label="On duty"
          value={String(onDuty.length)}
          tone="sky"
          detail={onDuty.length > 0 ? onDuty.map((shift) => shift.employeeName).join(", ") : "Nobody clocked in"}
        />
      ) : null}
      {recentShifts ? (
        <KpiCard
          icon={Wallet}
          label="Cash variance"
          value={
            latestClosedShift
              ? latestClosedShift.varianceCents
                ? formatVariance(latestClosedShift.varianceCents)
                : "Matched"
              : "—"
          }
          tone={latestClosedShift?.varianceCents ? "destructive" : latestClosedShift ? "success" : "neutral"}
          detail="Most recent closed shift"
        />
      ) : null}
    </div>
  );
}
