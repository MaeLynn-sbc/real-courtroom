import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { bookingService } from "@/services/booking/booking.service";

export const metadata: Metadata = {
  title: "Find My Booking",
  description: "Look up a booking by reference and phone number.",
};

export const dynamic = "force-dynamic";

interface LookupPageProps {
  searchParams: Promise<{ reference?: string; phone?: string }>;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default async function LookupPage({ searchParams }: LookupPageProps) {
  const { reference, phone } = await searchParams;
  const hasQuery = Boolean(reference && phone);
  const booking =
    hasQuery && reference && phone ? await bookingService.findByReferenceAndPhone(reference, phone) : null;

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Find My Booking</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Enter your booking reference and phone number.
          </p>
        </div>

        <form className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference">Booking reference</Label>
            <Input id="reference" name="reference" defaultValue={reference} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input id="phone" name="phone" type="tel" defaultValue={phone} required />
          </div>
          <Button type="submit" size="lg">
            Find booking
          </Button>
        </form>

        {hasQuery ? (
          booking ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="font-mono text-base">{booking.bookingReference}</CardTitle>
                <BookingStatusBadge status={booking.status} />
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Court</span>
                  <span className="font-medium">{booking.court.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Start</span>
                  <span className="font-medium">{dateTimeFormatter.format(booking.startAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">End</span>
                  <span className="font-medium">{dateTimeFormatter.format(booking.endAt)}</span>
                </div>
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground text-sm">
              No booking found for that reference and phone number.
            </p>
          )
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
