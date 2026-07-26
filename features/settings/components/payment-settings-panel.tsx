"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setBookingRequirePrepaymentAction } from "@/actions/payment-settings.actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

// Phase 8 (BUILD-SPEC.md §8) — the single owner-facing control for the
// switch built in Gate 2 (settingsService.getBookingRequirePrepayment).
// Default OFF; flipping it on requires GCash prepayment for every new
// public court booking, with staff verification via /dashboard/bookings/
// verify-payments.
export function PaymentSettingsPanel({ requirePrepayment }: { requirePrepayment: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <p className="font-medium">Require GCash prepayment for public bookings</p>
            <p className="text-muted-foreground text-xs">
              When on, a booking made through the public website holds the slot for 30 minutes and
              waits on staff to verify a submitted GCash payment before it confirms. Staff bookings
              are never affected.
            </p>
          </div>
          <Switch
            checked={requirePrepayment}
            onCheckedChange={handleChange}
            disabled={isPending}
            aria-label="Require GCash prepayment for public bookings"
          />
        </div>
      </CardContent>
    </Card>
  );
}
