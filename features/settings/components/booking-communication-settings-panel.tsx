"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setBookingCommunicationSettingsAction } from "@/actions/payment-settings.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BookingCommunicationSettings } from "@/features/cms/schemas/cms.schema";

// Owner decision (2026-08-03): every customer-facing string mentioning
// timing, contact channel, or the phone number must be editable here,
// not hardcoded in a component. {phone}/{reference}/{court}/{date}/
// {time}/{duration} are the only placeholders substituted — noted in
// the field hints below so an owner editing this doesn't have to guess.
export function BookingCommunicationSettingsPanel({
  settings,
}: {
  settings: BookingCommunicationSettings;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [smsSenderName, setSmsSenderName] = useState(settings.smsSenderName ?? "");
  const [smsConfirmationTemplate, setSmsConfirmationTemplate] = useState(
    settings.smsConfirmationTemplate,
  );
  const [pageConfirmationCopy, setPageConfirmationCopy] = useState(settings.pageConfirmationCopy);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!smsConfirmationTemplate.trim() || !pageConfirmationCopy.trim()) {
      toast.error("Both the SMS message and the confirmation page copy are required.");
      return;
    }

    startTransition(async () => {
      const result = await setBookingCommunicationSettingsAction({
        smsSenderName: smsSenderName.trim() || undefined,
        smsConfirmationTemplate: smsConfirmationTemplate.trim(),
        pageConfirmationCopy: pageConfirmationCopy.trim(),
      });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Booking communication settings saved.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking communication</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smsSenderName">SMS sender name (optional)</Label>
            <Input
              id="smsSenderName"
              value={smsSenderName}
              onChange={(event) => setSmsSenderName(event.target.value)}
              placeholder="Leave blank to use Semaphore's default sender"
            />
            <p className="text-muted-foreground text-xs">
              A CUSTOM sender name needs Semaphore&apos;s approval first. Leave this blank until
              that&apos;s approved — messages send fine without it, from Semaphore&apos;s default
              sender.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smsConfirmationTemplate">SMS confirmation message</Label>
            <Textarea
              id="smsConfirmationTemplate"
              value={smsConfirmationTemplate}
              onChange={(event) => setSmsConfirmationTemplate(event.target.value)}
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Placeholders: {"{reference} {court} {date} {time} {duration}"}. Sent once staff mark a
              payment verified. 160 characters = 1 SMS credit; longer messages cost more. Currently{" "}
              {smsConfirmationTemplate.length} characters.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pageConfirmationCopy">Booking confirmation page copy</Label>
            <Textarea
              id="pageConfirmationCopy"
              value={pageConfirmationCopy}
              onChange={(event) => setPageConfirmationCopy(event.target.value)}
              rows={3}
            />
            <p className="text-muted-foreground text-xs">
              Shown on the confirmation page after a customer uploads their payment screenshot.
              Placeholder: {"{phone}"} (the booking&apos;s own phone number).
            </p>
          </div>
          <Button type="submit" size="sm" disabled={isPending} className="self-start">
            {isPending ? "Saving…" : "Save"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
