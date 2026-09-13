import Link from "next/link";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { coachingFeeCents } from "@/lib/booking-payment-total";
import { coachSessionWindow, describeTimeWindow } from "@/lib/coach-session-window";
import { coachSessionService } from "@/services/coaching/coach-session.service";

export const metadata: Metadata = {
  title: "Coaching Sessions",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

export default async function CoachingSessionsPage() {
  const sessions = await coachSessionService.listSessions();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Coaching sessions</h1>
          <p className="text-muted-foreground text-sm">
            Every coach session, across every court booking. Add a coach from the booking&apos;s own
            detail page.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/coaching/availability" className={buttonVariants({ variant: "outline" })}>
            My availability
          </Link>
          <Link href="/dashboard/coaching/rates" className={buttonVariants({ variant: "outline" })}>
            Rates
          </Link>
        </div>
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          title="No coaching sessions yet"
          description="Add a coach from a booking's detail page to see it here."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Reference</TableHead>
              <TableHead>Coach</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Coached window</TableHead>
              <TableHead>Group</TableHead>
              <TableHead>Charge</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => {
              const customerName =
                session.player?.user.name ?? session.player?.user.email ?? session.guestName ?? "—";
              return (
                <TableRow key={session.id}>
                  <TableCell>
                    <Link href={`/dashboard/bookings/${session.bookingId}`} className="font-medium hover:underline">
                      {session.sessionReference}
                    </Link>
                  </TableCell>
                  <TableCell>{session.coach.user.name ?? session.coach.user.email}</TableCell>
                  <TableCell>{customerName}</TableCell>
                  <TableCell>
                    {dateTimeFormatter.format(coachSessionWindow(session.booking.startAt, session).startAt)}
                    <span className="text-muted-foreground block text-xs">
                      {describeTimeWindow(coachSessionWindow(session.booking.startAt, session))} ·{" "}
                      {session.hours} {session.hours === 1 ? "hour" : "hours"}
                    </span>
                  </TableCell>
                  <TableCell>{session.groupSize}</TableCell>
                  <TableCell>
                    {formatCurrency(coachingFeeCents(session))}
                    <span className="text-muted-foreground block text-xs">{formatCurrency(session.rateCents)}/hour</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{session.source}</Badge>
                  </TableCell>
                  <TableCell>{session.status}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
