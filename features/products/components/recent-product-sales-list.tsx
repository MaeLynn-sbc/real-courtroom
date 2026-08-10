"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { voidSaleAction } from "@/actions/sale.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export interface RecentProductSaleRow {
  id: string;
  productName: string;
  amountCents: number;
  employeeName: string;
  paymentMethodLabel: string;
  status: string;
  createdAt: string;
  voidReason: string | null;
  voidedByEmployeeName: string | null;
}

interface RecentProductSalesListProps {
  sales: RecentProductSaleRow[];
  canVoidSale: boolean;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

function VoidButton({ saleId }: { saleId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleVoid() {
    // Owner request (2026-08-10): "the staff encoded wrong product and
    // wants it to void" — same plain window.prompt reason-capture shape
    // as writeOffTabAction's own button, for consistency.
    const reason = window.prompt("Reason for voiding this sale?");
    if (!reason?.trim()) return;
    startTransition(async () => {
      const result = await voidSaleAction({ saleId, reason: reason.trim() });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Sale voided.");
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="text-destructive hover:text-destructive"
      disabled={isPending}
      onClick={handleVoid}
    >
      {isPending ? "Voiding…" : "Void"}
    </Button>
  );
}

export function RecentProductSalesList({ sales, canVoidSale }: RecentProductSalesListProps) {
  if (sales.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent sales</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sales.map((sale) => (
          <div
            key={sale.id}
            className="flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0"
          >
            <div>
              <span className="font-medium">{sale.productName}</span>
              <p className="text-muted-foreground text-xs">
                {dateTimeFormatter.format(new Date(sale.createdAt))} · {sale.employeeName} ·{" "}
                {sale.paymentMethodLabel}
              </p>
              {sale.status === "VOID" && sale.voidReason ? (
                <p className="text-destructive text-xs">
                  Voided by {sale.voidedByEmployeeName ?? "—"}: {sale.voidReason}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm">{formatCurrency(sale.amountCents)}</span>
              {sale.status === "VOID" ? <Badge variant="destructive">Voided</Badge> : null}
              {canVoidSale && sale.status === "COMPLETED" ? <VoidButton saleId={sale.id} /> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
