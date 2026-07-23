"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setOtherRatesAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OtherRateLine } from "@/features/cms/schemas/cms.schema";
import { formatCurrency } from "@/lib/utils";

interface CourtRate {
  id: string;
  name: string;
  hourlyRateCents: number | null;
}

export function RatesPanel({
  courtRates,
  otherRates,
}: {
  courtRates: CourtRate[];
  otherRates: OtherRateLine[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(otherRates);
  const [label, setLabel] = useState("");
  const [priceText, setPriceText] = useState("");
  const [isPending, startTransition] = useTransition();

  function save(nextRows: OtherRateLine[]) {
    startTransition(async () => {
      const result = await setOtherRatesAction(nextRows);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setRows(nextRows);
      toast.success("Rates saved.");
      router.refresh();
    });
  }

  function handleAdd() {
    if (!label.trim() || !priceText.trim()) {
      return;
    }
    const nextRows = [...rows, { label: label.trim(), priceText: priceText.trim() }];
    save(nextRows);
    setLabel("");
    setPriceText("");
  }

  function handleRemove(index: number) {
    save(rows.filter((_, rowIndex) => rowIndex !== index));
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rates</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Court rental rates
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {courtRates.map((court) => (
              <li key={court.id} className="flex justify-between rounded-lg border px-3 py-2">
                <span>{court.name}</span>
                <span className="tabular-nums">
                  {court.hourlyRateCents != null ? `${formatCurrency(court.hourlyRateCents)}/hr` : "—"}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            Managed from the Courts admin page — shown here read-only.
          </p>
        </div>

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            Other public pricing
          </p>
          {rows.length === 0 ? (
            <p className="text-muted-foreground text-sm">No other pricing lines yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {rows.map((row, index) => (
                <li
                  key={`${row.label}-${index}`}
                  className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                >
                  <span>{row.label}</span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{row.priceText}</span>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleRemove(index)}
                      aria-label={`Remove ${row.label}`}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rateLabel">Label</Label>
              <Input id="rateLabel" value={label} onChange={(event) => setLabel(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ratePrice">Price</Label>
              <Input
                id="ratePrice"
                placeholder="₱150/hr"
                value={priceText}
                onChange={(event) => setPriceText(event.target.value)}
              />
            </div>
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleAdd}>
              Add
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
