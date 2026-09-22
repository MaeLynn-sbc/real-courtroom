"use client";

import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { exportReportCsvAction, exportReportExcelAction } from "@/actions/report.actions";
import { Button } from "@/components/ui/button";
import type { ExportReportInput } from "@/features/reports/schemas/report.schema";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Owner request (2026-09-22): "can be exported to pdf or excel file",
// with CSV kept as well. Three buttons rather than a format dropdown —
// the report screen is used at a desk, and one click beats two.
export function ExportButtons({ input }: { input: ExportReportInput }) {
  const [isPending, startTransition] = useTransition();

  function handleCsv() {
    startTransition(async () => {
      const result = await exportReportCsvAction(input);
      if (result.error || !result.csv || !result.filename) {
        toast.error(result.error ?? "Failed to export report.");
        return;
      }
      download(new Blob([result.csv], { type: "text/csv;charset=utf-8;" }), result.filename);
    });
  }

  function handleExcel() {
    startTransition(async () => {
      const result = await exportReportExcelAction(input);
      if (result.error || !result.xlsxBase64 || !result.filename) {
        toast.error(result.error ?? "Failed to export report.");
        return;
      }
      // base64 -> bytes. The action can't hand back a Blob, so the
      // workbook travels as text and is rebuilt here.
      const binary = atob(result.xlsxBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      download(
        new Blob([bytes], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        result.filename,
      );
    });
  }

  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <Button type="button" variant="outline" disabled={isPending} onClick={handleExcel}>
        <FileSpreadsheet className="size-4" aria-hidden="true" />
        Excel
      </Button>
      {/* PDF is the browser's own print-to-PDF: the page carries a print
          stylesheet that drops the nav and prints the table across as
          many sheets as it needs. No server-side PDF engine, and what
          prints is exactly what is on screen. */}
      <Button type="button" variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden="true" />
        PDF
      </Button>
      <Button type="button" variant="outline" disabled={isPending} onClick={handleCsv}>
        <Download className="size-4" aria-hidden="true" />
        CSV
      </Button>
    </div>
  );
}
