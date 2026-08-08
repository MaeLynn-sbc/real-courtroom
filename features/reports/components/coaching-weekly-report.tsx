import Link from "next/link";

import { ExportCsvButton } from "@/features/reports/components/export-csv-button";
import { UncollectedCoachSessions } from "@/features/reports/components/uncollected-coach-sessions";
import { toSettlementPaymentMethodOptions } from "@/lib/settlement-payment-methods";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import {
  reportingService,
  type CoachingReportRow,
  type UncollectedCoachSessionRow,
} from "@/services/reporting/reporting.service";
import { saleService } from "@/services/sales/sale.service";

// Owner request (2026-08-04): "separate their tables since theres only 2
// of them" (same "own tables, not a dropdown" preference already applied
// to the coach availability admin page) — plus weekly Sun-Sat tabs with a
// running total per coach, and older weeks tucked behind an Archive tab
// rather than cluttering the main view. Replaces the generic reports
// page's DateRangePicker/single-table chrome entirely for this one
// report type — see app/dashboard/reports/[reportType]/page.tsx's early
// branch to this component.
// Owner request (2026-08-04): trimmed from 4 to 2 — "we dont have the
// website yet at that time," so weeks that far back never have any real
// data and just added clutter. Anything genuinely older still reachable
// via the Archive tab, unchanged.
const RECENT_WEEKS_COUNT = 2;

const rangeHeadingFormatter = new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" });
const rangeHeadingWithYearFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const sessionDateFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function weekParamValue(weekStart: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${weekStart.getFullYear()}-${pad(weekStart.getMonth() + 1)}-${pad(weekStart.getDate())}`;
}

function formatWeekLabel(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6);
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear();
  const startLabel = rangeHeadingFormatter.format(weekStart);
  const endLabel = sameYear
    ? rangeHeadingFormatter.format(weekEnd)
    : rangeHeadingWithYearFormatter.format(weekEnd);
  return `${startLabel} – ${endLabel}${sameYear ? `, ${weekEnd.getFullYear()}` : ""}`;
}

function parseWeekParam(raw: string | string[] | undefined): Date | null {
  if (typeof raw !== "string") return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return startOfWeek(parsed); // normalized to the real Sunday even if the param lands mid-week
}

interface CoachingWeeklyReportProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export async function CoachingWeeklyReport({ searchParams }: CoachingWeeklyReportProps) {
  const currentWeekStart = startOfWeek(new Date());
  const recentWeekStarts = Array.from({ length: RECENT_WEEKS_COUNT }, (_, index) =>
    addDays(currentWeekStart, -7 * index),
  );

  const requestedWeekStart = parseWeekParam(searchParams.week);
  const isRecentWeek = (candidate: Date) =>
    recentWeekStarts.some((week) => week.getTime() === candidate.getTime());

  // Archive tab, no explicit ?week=: default to the week right before the
  // recent set, not the current week — landing on "Archive" should show
  // something actually archived, not a duplicate of the "This week" tab.
  const archiveDefaultWeekStart = addDays(currentWeekStart, -7 * RECENT_WEEKS_COUNT);
  const onArchiveTab = searchParams.tab === "archive";

  const selectedWeekStart =
    requestedWeekStart ?? (onArchiveTab ? archiveDefaultWeekStart : currentWeekStart);
  const activeTabIsArchive = onArchiveTab || !isRecentWeek(selectedWeekStart);

  const selectedWeekEnd = new Date(addDays(selectedWeekStart, 7).getTime() - 1);

  const [coaches, { rows }, collectedByCoach, uncollectedRows, paymentMethods] = await Promise.all([
    coachAvailabilityService.listCoaches(),
    reportingService.getCoachingReport({ from: selectedWeekStart, to: selectedWeekEnd }),
    reportingService.getCoachingFeesByCoachReport({ from: selectedWeekStart, to: selectedWeekEnd }),
    reportingService.getUncollectedCoachSessionsReport({ from: selectedWeekStart, to: selectedWeekEnd }),
    saleService.listPaymentMethods(),
  ]);
  const collectedByCoachId = new Map(collectedByCoach.map((row) => [row.coachId, row.amountCents]));
  const settlementPaymentMethods = toSettlementPaymentMethodOptions(paymentMethods);

  const rowsByCoachId = new Map<string, CoachingReportRow[]>();
  for (const row of rows) {
    const existing = rowsByCoachId.get(row.coachId);
    if (existing) {
      existing.push(row);
    } else {
      rowsByCoachId.set(row.coachId, [row]);
    }
  }

  const uncollectedByCoachId = new Map<string, UncollectedCoachSessionRow[]>();
  for (const row of uncollectedRows) {
    const existing = uncollectedByCoachId.get(row.coachId);
    if (existing) {
      existing.push(row);
    } else {
      uncollectedByCoachId.set(row.coachId, [row]);
    }
  }

  function weekHref(weekStart: Date, tab?: "archive"): string {
    const params = new URLSearchParams();
    params.set("week", weekParamValue(weekStart));
    if (tab) params.set("tab", tab);
    return `?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coaching report</h1>
          <p className="text-muted-foreground text-sm">
            Each coach&apos;s sessions and fees, by week ({formatWeekLabel(selectedWeekStart)}).
          </p>
        </div>
        <ExportCsvButton
          input={{
            reportType: "coaching",
            range: { preset: "CUSTOM", from: selectedWeekStart, to: selectedWeekEnd },
          }}
        />
      </div>

      <div role="tablist" aria-label="Week" className="flex flex-wrap gap-1 border-b">
        {recentWeekStarts.map((week, index) => {
          const isActive = !activeTabIsArchive && week.getTime() === selectedWeekStart.getTime();
          return (
            <Link
              key={weekParamValue(week)}
              href={weekHref(week)}
              role="tab"
              aria-selected={isActive}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {index === 0 ? "This week" : formatWeekLabel(week)}
            </Link>
          );
        })}
        <Link
          href={weekHref(
            isRecentWeek(selectedWeekStart) ? archiveDefaultWeekStart : selectedWeekStart,
            "archive",
          )}
          role="tab"
          aria-selected={activeTabIsArchive}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
            activeTabIsArchive
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          Archive
        </Link>
      </div>

      {activeTabIsArchive ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={weekHref(addDays(selectedWeekStart, -7), "archive")}
            className="text-primary text-sm underline underline-offset-2"
          >
            ← Previous week
          </Link>
          {/* Zero-client-JS date jump, same GET-form pattern as the public
              availability grid's date picker. */}
          <form className="flex items-center gap-2">
            <input type="hidden" name="tab" value="archive" />
            <input
              type="date"
              name="week"
              defaultValue={weekParamValue(selectedWeekStart)}
              className="border-input bg-background rounded-md border px-2 py-1 text-sm"
            />
            <button
              type="submit"
              className="border-input hover:bg-muted rounded-md border px-2 py-1 text-sm"
            >
              Go
            </button>
          </form>
          {addDays(selectedWeekStart, 7).getTime() < currentWeekStart.getTime() ? (
            (() => {
              const nextWeek = addDays(selectedWeekStart, 7);
              // Paging forward can reach a week that has its own recent-
              // week tab — link there plainly (no forced tab=archive) so
              // that tab correctly highlights instead of Archive staying
              // stuck active for a week it doesn't actually own.
              return (
                <Link
                  href={weekHref(nextWeek, isRecentWeek(nextWeek) ? undefined : "archive")}
                  className="text-primary text-sm underline underline-offset-2"
                >
                  Next week →
                </Link>
              );
            })()
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {coaches.map((coach) => {
          const coachRows = rowsByCoachId.get(coach.id) ?? [];
          const workedCents = coachRows
            .filter((row) => row.status !== "CANCELLED")
            .reduce((sum, row) => sum + row.rateCents, 0);
          const collectedCents = collectedByCoachId.get(coach.id) ?? 0;
          const uncollectedSessions = (uncollectedByCoachId.get(coach.id) ?? []).map((row) => ({
            id: row.id,
            sessionReference: row.sessionReference,
            playerName: row.playerName,
            bookingReference: row.bookingReference,
            startAt: row.startAt.toISOString(),
            rateCents: row.rateCents,
          }));

          return (
            <div key={coach.id} className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-medium">{coach.user.name ?? coach.user.email}</h2>
                <div className="flex flex-col items-end gap-0.5">
                  <p className="font-semibold tabular-nums">
                    Collected: {formatCurrency(collectedCents)}
                  </p>
                  {collectedCents !== workedCents ? (
                    <p className="text-muted-foreground text-xs tabular-nums">
                      Sessions worked: {formatCurrency(workedCents)}
                    </p>
                  ) : null}
                </div>
              </div>

              {coachRows.length === 0 ? (
                <p className="text-muted-foreground text-sm">No sessions this week.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-muted-foreground border-b text-left text-xs">
                        <th className="py-1.5 pr-3 font-normal">Reference</th>
                        <th className="py-1.5 pr-3 font-normal">Player</th>
                        <th className="py-1.5 pr-3 font-normal">Booking</th>
                        <th className="py-1.5 pr-3 font-normal">Start</th>
                        <th className="py-1.5 pr-3 font-normal">Status</th>
                        <th className="py-1.5 text-right font-normal">Fee</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coachRows.map((row) => (
                        <tr key={row.id} className="border-b last:border-0">
                          <td className="py-1.5 pr-3">{row.sessionReference}</td>
                          <td className="py-1.5 pr-3">{row.playerName ?? "—"}</td>
                          <td className="py-1.5 pr-3">{row.bookingReference}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {sessionDateFormatter.format(row.startAt)}
                          </td>
                          <td className="py-1.5 pr-3">{row.status}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {formatCurrency(row.rateCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <UncollectedCoachSessions
                sessions={uncollectedSessions}
                paymentMethods={settlementPaymentMethods}
              />

              <p className="text-muted-foreground text-xs">
                &quot;Collected&quot; is real, recorded revenue (money actually received). &quot;Sessions
                worked&quot; only shows when it differs from Collected (e.g. a voided payment).
                &quot;Not yet collected&quot; above lists sessions with no payment recorded at all —
                mark one collected there once you know which method it came in through.
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
