import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SpecialEventForm } from "@/features/courts/components/special-event-form";
import { SpecialEventList } from "@/features/courts/components/special-event-list";
import { courtService } from "@/services/court/court.service";

export const metadata: Metadata = {
  title: "Block Courts",
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
        <h1 className="text-2xl font-semibold tracking-tight">Block Courts</h1>
        <p className="text-muted-foreground text-sm">
          Take one or more courts off the public grid for a date and time. Choose{" "}
          <span className="font-medium">Open play</span> to hand the court over for the night — it
          shows exactly like the regular open-play hours — or{" "}
          <span className="font-medium">Special event</span> to show &quot;Booked for special
          events&quot;.
          <br />
          For a STANDING handover that repeats every week, use the per-court cutoffs in Admin →
          Website instead. This page is for one date only.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Block courts</CardTitle>
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
