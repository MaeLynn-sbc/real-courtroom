import type { Metadata } from "next";
import Link from "next/link";

import { ShiftTemplateSettings } from "@/features/payroll/components/shift-template-settings";
import { shiftTemplateService } from "@/services/payroll/shift-template.service";

export const metadata: Metadata = {
  title: "Payroll — Shift times",
};

// Same reason as every other payroll page — a saved template must show
// up immediately, not after a stale cache serves the old times.
export const dynamic = "force-dynamic";

export default async function ShiftTemplateSettingsPage() {
  const templates = await shiftTemplateService.listTemplates();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Shift times</h1>
          <p className="text-muted-foreground text-sm">
            Manage the named shifts (Opening, Closing, etc.) the Schedule page assigns from.
            Retiring a shift never removes it from days it was already assigned on — it just
            stops appearing as a choice for new assignments.
          </p>
        </div>
        <Link
          href="/dashboard/payroll/schedule"
          className="text-primary text-sm underline underline-offset-2"
        >
          ← Back to Schedule
        </Link>
      </div>

      <ShiftTemplateSettings
        templates={templates.map((template) => ({
          id: template.id,
          name: template.name,
          startTime: template.startTime,
          endTime: template.endTime,
          active: template.active,
        }))}
      />
    </div>
  );
}
