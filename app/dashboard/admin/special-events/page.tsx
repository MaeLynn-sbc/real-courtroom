import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpecialEventForm } from "@/features/courts/components/special-event-form";
import { SpecialEventList } from "@/features/courts/components/special-event-list";
import { courtService } from "@/services/court/court.service";

export const metadata: Metadata = {
  title: "Special Events",
};

// Same reason as every other admin/ops page in this app — a newly
// blocked or cancelled event must show up immediately.
export const dynamic = "force-dynamic";

export default async function SpecialEventsPage() {
  const [courts, events] = await Promise.all([
    courtService.listCourts(),
    courtService.listSpecialEvents(),
  ]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Special Events</h1>
        <p className="text-muted-foreground text-sm">
          Block one or more courts for a date and time — shown on the public availability grid as
          &quot;Booked for special events&quot; instead of the normal open slot.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Block courts for an event</CardTitle>
        </CardHeader>
        <CardContent>
          <SpecialEventForm courts={courts.map((court) => ({ id: court.id, name: court.name }))} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Upcoming and past events</CardTitle>
        </CardHeader>
        <CardContent>
          <SpecialEventList
            events={events.map((event) => ({
              id: event.id,
              courtName: event.court.name,
              reason: event.reason,
              notes: event.notes,
              startAt: event.startAt,
              endAt: event.endAt,
              status: event.status,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
