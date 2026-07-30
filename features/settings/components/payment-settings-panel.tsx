"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setBookingHoldMinutesAction, setBookingRequirePrepaymentAction } from "@/actions/payment-settings.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Phase 8 (BUILD-SPEC.md §8) — the single owner-facing control for the
// switch built in Gate 2 (settingsService.getBookingRequirePrepayment).
// Default ON as of the owner's deploy decision (requires GCash
// prepayment for every new public court booking, with staff
// verification via /dashboard/bookings/verify-payments); flipping it
// off returns to instant pay-at-court confirmation, same as before
// Phase 8.
export function PaymentSettingsPanel({
  requirePrepayment,
  holdMinutes,
}: {
  requirePrepayment: boolean;
  holdMinutes: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [holdMinutesInput, setHoldMinutesInput] = useState(String(holdMinutes));
  const [holdError, setHoldError] = useState<string | null>(null);

  function handleChange(checked: boolean) {
    startTransition(async () => {
      const result = await setBookingRequirePrepaymentAction(checked);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`GCash prepayment ${checked ? "required" : "no longer required"} for public bookings.`);
      router.refresh();
    });
  }

  function handleHoldMinutesSubmit(event: React.FormEvent) {
    event.preventDefault();
    setHoldError(null);

    const parsed = Number(holdMinutesInput);
    startTransition(async () => {
      const result = await setBookingHoldMinutesAction(parsed);
      if (result.error) {
        setHoldError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Hold window set to ${parsed} minutes.`);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <p className="font-medium">Require GCash prepayment for public bookings</p>
            <p className="text-muted-foreground text-xs">
              When on, a booking made through the public website holds the slot for {holdMinutes}{" "}
              minutes and waits on staff to verify a submitted GCash payment before it confirms.
              Staff bookings are never affected.
            </p>
          </div>
          <Switch
            checked={requirePrepayment}
            onCheckedChange={handleChange}
            disabled={isPending}
            aria-label="Require GCash prepayment for public bookings"
          />
        </div>

        <form onSubmit={handleHoldMinutesSubmit} className="flex flex-col gap-1.5 rounded-xl border p-4">
          <Label htmlFor="holdMinutes" className="font-medium">
            Hold window (minutes)
          </Label>
          <p className="text-muted-foreground text-xs">
            How long an unpaid public booking holds its slot before it must be paid. Applies only
            while prepayment is required, above.
          </p>
          <div className="mt-1 flex items-center gap-2">
            <Input
              id="holdMinutes"
              type="number"
              min={5}
              max={240}
              className="w-24"
              value={holdMinutesInput}
              onChange={(event) => setHoldMinutesInput(event.target.value)}
            />
            <Button type="submit" variant="outline" size="sm" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {holdError ? <p className="text-destructive text-sm">{holdError}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
