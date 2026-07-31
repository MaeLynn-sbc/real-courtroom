"use client";

import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type TabKey = "gcash" | "cash";

// Cash reconciliation was added "in the g-cash reconciliation tab" —
// same page, a plain client tab switch between the two otherwise-
// independent workspaces (each already has its own seed/confirm/
// override actions and its own day-scoped balance record).
export function ReconciliationTabs({ gcash, cash }: { gcash: ReactNode; cash: ReactNode }) {
  const [activeTab, setActiveTab] = useState<TabKey>("gcash");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b" role="tablist">
        {(
          [
            { key: "gcash", label: "GCash" },
            { key: "cash", label: "Cash" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "border-court-blue text-court-blue"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{activeTab === "gcash" ? gcash : cash}</div>
    </div>
  );
}
