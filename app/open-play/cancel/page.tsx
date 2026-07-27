import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CancelOpenPlayRegistrationForm } from "@/features/open-play-capacity/components/cancel-open-play-registration-form";
import { openPlayRegistrationService } from "@/services/open-play/open-play-registration.service";

export const metadata: Metadata = {
  title: "Cancel My Open Play Registration",
  description: "Find and cancel an open play registration by phone number and night.",
};

export const dynamic = "force-dynamic";

interface CancelPageProps {
  searchParams: Promise<{ phone?: string; date?: string }>;
}

const dateFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "full" });

export default async function OpenPlayCancelPage({ searchParams }: CancelPageProps) {
  const { phone, date } = await searchParams;
  const hasQuery = Boolean(phone && date);
  const registration =
    hasQuery && phone && date
      ? await openPlayRegistrationService.findConfirmedRegistrationForCancellation(
          phone,
          new Date(`${date}T00:00:00`),
        )
      : null;

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Cancel My Registration</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Enter the phone number and night you registered for.
          </p>
        </div>

        <form className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={phone} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="date">Night</Label>
            <Input id="date" name="date" type="date" defaultValue={date} required />
          </div>
          <Button type="submit" size="lg">
            Find my registration
          </Button>
        </form>

        {hasQuery ? (
          registration ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{registration.playerName}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Night</span>
                  <span className="font-medium">{dateFormatter.format(registration.date)}</span>
                </div>
                <p className="text-muted-foreground bg-muted/40 rounded-lg border p-2 text-xs">
                  Cancelling more than 4 hours before your session starts gets you credit toward a future
                  night. Cancelling after that, or not showing up, forfeits the registration fee — no cash
                  back either way.
                </p>
                <CancelOpenPlayRegistrationForm registrationId={registration.id} phone={phone ?? ""} />
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground text-sm">
              No confirmed registration found for that phone number and night.
            </p>
          )
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
