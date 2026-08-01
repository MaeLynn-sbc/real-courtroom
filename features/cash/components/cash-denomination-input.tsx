"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// PHP denominations actually handled at the drawer — centavo coins
// (25/10/5c) aren't tracked here since this venue's rates are whole
// pesos; "Enter amount directly" below still covers an exact count when
// one shows up anyway.
const BILLS = [1000, 500, 200, 100, 50, 20] as const;
const COINS = [10, 5, 1] as const;

function sumPesos(counts: Record<number, string>): number {
  return [...BILLS, ...COINS].reduce((total, denom) => {
    const count = Number(counts[denom]) || 0;
    return total + denom * count;
  }, 0);
}

interface CashDenominationInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
}

// Cash-only (GCash is digital, no physical notes to count). Swaps between
// a plain amount field (the original behavior, kept as the default and
// as an escape hatch) and a bills/coins count that sums into the same
// controlled value — the parent form never knows which mode produced it.
export function CashDenominationInput({ id, value, onChange }: CashDenominationInputProps) {
  const [mode, setMode] = useState<"amount" | "denominations">("amount");
  const [counts, setCounts] = useState<Record<number, string>>({});

  function updateCount(denom: number, count: string) {
    const next = { ...counts, [denom]: count };
    setCounts(next);
    onChange(String(sumPesos(next)));
  }

  if (mode === "amount") {
    return (
      <div className="flex flex-col gap-1.5">
        <Input
          id={id}
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto self-start p-0 text-xs"
          onClick={() => {
            setCounts({});
            setMode("denominations");
          }}
        >
          Count by bills &amp; coins…
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <div className="grid grid-cols-3 gap-2">
        {BILLS.map((denom) => (
          <div key={denom} className="flex flex-col gap-1">
            <Label htmlFor={`${id}-${denom}`} className="text-xs">
              ₱{denom} bill
            </Label>
            <Input
              id={`${id}-${denom}`}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="0"
              value={counts[denom] ?? ""}
              onChange={(event) => updateCount(denom, event.target.value)}
            />
          </div>
        ))}
        {COINS.map((denom) => (
          <div key={denom} className="flex flex-col gap-1">
            <Label htmlFor={`${id}-${denom}`} className="text-xs">
              ₱{denom} coin
            </Label>
            <Input
              id={`${id}-${denom}`}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="0"
              value={counts[denom] ?? ""}
              onChange={(event) => updateCount(denom, event.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between border-t pt-2 text-sm">
        <span className="text-muted-foreground">Counted total</span>
        <span className="font-semibold tabular-nums">
          ₱{(Number(value) || 0).toLocaleString("en-PH")}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-start"
        onClick={() => setMode("amount")}
      >
        Enter amount directly instead
      </Button>
    </div>
  );
}
