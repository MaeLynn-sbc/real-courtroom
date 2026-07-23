"use client";

import { Download } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { exportReportCsvAction } from "@/actions/report.actions";
import { Button } from "@/components/ui/button";
import type { ExportReportInput } from "@/features/reports/schemas/report.schema";

export function ExportCsvButton({ input }: { input: ExportReportInput }) {
  const [isPending, startTransition] = useTransition();

  function handleExport() {
    startTransition(async () => {
      const result = await exportReportCsvAction(input);
      if (result.error || !result.csv || !result.filename) {
        toast.error(result.error ?? "Failed to export report.");
        return;
      }

      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    });
  }

  return (
    <Button type="button" variant="outline" disabled={isPending} onClick={handleExport}>
      <Download className="size-4" aria-hidden="true" />
      Export CSV
    </Button>
  );
}
