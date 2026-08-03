"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type TabKey = "rotation" | "checkIn" | "tabs" | "roster";

const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: "rotation", label: "Rotation" },
  { key: "tabs", label: "Player tabs" },
  { key: "roster", label: "Roster" },
  // Owner (2026-08-03): moved to the bottom, after Player tabs.
  { key: "checkIn", label: "Check in" },
];

interface OpenPlaySessionTabsProps {
  rotation: ReactNode;
  checkIn: ReactNode;
  tabs: ReactNode;
  roster: ReactNode;
  // Badge on the Check in tab — count of registrations expected tonight
  // that haven't checked in yet, so staff know to look without switching.
  expectedNotCheckedInCount: number;
  // Same setting the TV display's own auto-refresh already uses
  // (display.refreshInterval, owner-editable) — reused here rather than
  // inventing a second interval, so the staff screen and the TV always
  // agree on how "live" is defined.
  refreshIntervalSeconds: number;
}

// Reported live: staff work from the rotation board all night and had to
// scroll past the walk-in form, Expected/Checked-in, and the full Roster
// to reach it every single time. Rotation is now the default, always-
// first view; everything else lives behind a tab. Tab selection is plain
// client state in this wrapper component — router.refresh() (from the
// auto-poll below, or from any action inside a tab) re-renders the
// Server Component tree and passes fresh props down, but it does not
// remount this client component, so the selected tab survives every
// poll. Never reset it from a prop or an effect keyed on fetched data.
export function OpenPlaySessionTabs({
  rotation,
  checkIn,
  tabs,
  roster,
  expectedNotCheckedInCount,
  refreshIntervalSeconds,
}: OpenPlaySessionTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>("rotation");

  useEffect(() => {
    if (refreshIntervalSeconds <= 0) return;
    const id = setInterval(() => router.refresh(), refreshIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [refreshIntervalSeconds, router]);

  const panels: Record<TabKey, ReactNode> = {
    rotation,
    checkIn,
    tabs,
    roster,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 border-b" role="tablist">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-court-blue text-court-blue"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
            {tab.key === "checkIn" && expectedNotCheckedInCount > 0 ? (
              <Badge variant="warning">{expectedNotCheckedInCount}</Badge>
            ) : null}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panels[activeTab]}</div>
    </div>
  );
}
