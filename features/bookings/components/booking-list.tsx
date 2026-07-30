import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookingSourceBadge } from "@/features/bookings/components/booking-source-badge";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { formatRelativeTime } from "@/lib/utils";
import type { bookingService } from "@/services/booking/booking.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: true,
});

type Bookings = Awaited<ReturnType<typeof bookingService.listBookings>>;

interface BookingListProps {
  bookings: Bookings;
}

export function BookingList({ bookings }: BookingListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Reference</TableHead>
          <TableHead>Court</TableHead>
          <TableHead>Guest / Player</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Placed</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <TableRow key={booking.id}>
            <TableCell>
              <Link href={`/dashboard/bookings/${booking.id}`} className="font-medium hover:underline">
                {booking.bookingReference}
              </Link>
            </TableCell>
            <TableCell>{booking.court.name}</TableCell>
            <TableCell>{booking.player?.user.name ?? booking.guestName ?? "—"}</TableCell>
            <TableCell>
              {dateTimeFormatter.format(booking.startAt)} – {dateTimeFormatter.format(booking.endAt)}
            </TableCell>
            <TableCell>
              <span title={dateTimeFormatter.format(booking.createdAt)} className="text-muted-foreground text-sm">
                {formatRelativeTime(booking.createdAt)}
              </span>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <BookingSourceBadge source={booking.source} />
                {booking.source === "STAFF" ? (
                  // PUBLIC bookings' bookedBy is the seeded Website system
                  // identity, not a real employee — same STAFF-only
                  // condition getBookingById's "Booked by" field already
                  // uses on the detail page.
                  <span className="text-muted-foreground text-xs">
                    · {booking.bookedBy.name ?? booking.bookedBy.email}
                  </span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1.5">
                <BookingStatusBadge status={booking.status} />
                {booking.isAfterHours ? <Badge variant="warning">After Hours</Badge> : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
