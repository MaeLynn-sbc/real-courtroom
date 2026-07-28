"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setBusinessInfoAction } from "@/actions/cms.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BusinessInfo } from "@/features/cms/schemas/cms.schema";

// Owner decision: the "contact us" fallback shown to a customer with a
// payment problem (wrong file, no confirmation received) reuses the
// SAME phone/Facebook fields the rest of the public site already shows
// (features/cms/components/business-info-panel.tsx, /dashboard/admin/
// website) — deliberately not a second, separate pair of fields. One
// venue, one phone number and one Facebook page; a duplicate field here
// would just be a second place for those to go stale against each
// other. This panel edits the same BusinessInfo row via the same
// setBusinessInfoAction, just surfaced here too so an owner doesn't
// have to leave the payment settings screen to fix the number a
// customer with a stuck payment would call.
export function PaymentContactInfoPanel({ businessInfo }: { businessInfo: BusinessInfo }) {
  const router = useRouter();
  const [phone, setPhone] = useState(businessInfo.phone);
  const [facebookUrl, setFacebookUrl] = useState(businessInfo.facebookUrl);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const result = await setBusinessInfoAction({ ...businessInfo, phone, facebookUrl });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Contact fallback info saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment contact fallback</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-muted-foreground text-xs">
          Shown to a customer on the payment step if their upload has a problem — same phone
          number and Facebook page as the rest of the site (Website → Business information).
        </p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paymentContactPhone">Contact number</Label>
          <Input id="paymentContactPhone" value={phone} onChange={(event) => setPhone(event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="paymentContactFacebook">Facebook link</Label>
          <Input
            id="paymentContactFacebook"
            value={facebookUrl}
            onChange={(event) => setFacebookUrl(event.target.value)}
          />
        </div>
        <Button type="button" size="sm" disabled={isPending} onClick={handleSave} className="self-start">
          {isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
