import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BookingHistoryList } from "@/features/bookings/components/booking-history-list";
import { BookingQrCode } from "@/features/bookings/components/booking-qr-code";
import { BookingSourceBadge } from "@/features/bookings/components/booking-source-badge";
import { BookingStatusActions } from "@/features/bookings/components/booking-status-actions";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { RegenerateQrButton } from "@/features/bookings/components/regenerate-qr-button";
import { formatRelativeTime } from "@/lib/utils";
import { bookingService } from "@/services/booking/booking.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
});

interface BookingDetailPageProps {
  params: Promise<{ bookingId: string }>;
}

export async function generateMetadata({ params }: BookingDetailPageProps): Promise<Metadata> {
  const { bookingId } = await params;
  const booking = await bookingService.getBookingById(bookingId);
  return { title: booking?.bookingReference ?? "Booking" };
}

export default async function BookingDetailPage({ params }: BookingDetailPageProps) {
  const { bookingId } = await params;
  const booking = await bookingService.getBookingById(bookingId);

  if (!booking) {
    notFound();
  }

  const guestOrPlayerName = booking.player?.user.name ?? booking.player?.user.email ?? booking.guestName;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{booking.bookingReference}</h1>
          <p className="text-muted-foreground text-sm">
            {booking.court.name} · {dateTimeFormatter.format(booking.startAt)} –{" "}
            {dateTimeFormatter.format(booking.endAt)}
          </p>
          <p className="text-muted-foreground text-sm">
            Booked{" "}
            <span title={dateTimeFormatter.format(booking.createdAt)}>
              {formatRelativeTime(booking.createdAt)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <BookingSourceBadge source={booking.source} />
          <BookingStatusBadge status={booking.status} />
          {booking.isAfterHours ? <Badge variant="warning">After Hours</Badge> : null}
        </div>
      </div>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border p-4">
          <h2 className="text-sm font-medium">Details</h2>
          <dl className="text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Type</dt>
              <dd>{booking.type === "WALK_IN" ? "Walk-in" : "Hourly"}</dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-muted-foreground">Guest / Player</dt>
              <dd>{guestOrPlayerName ?? "—"}</dd>
            </div>
            {booking.source === "STAFF" ? (
              // Only shown for STAFF bookings — for PUBLIC ones, bookedBy
              // is the seeded Website system identity, not a real
              // employee, so "who booked this" isn't a meaningful
              // question to answer here.
              <div className="flex justify-between py-1">
                <dt className="text-muted-foreground">Booked by</dt>
                <dd>{booking.bookedBy.name ?? booking.bookedBy.email}</dd>
              </div>
            ) : null}
            {booking.guestPhone ? (
              <div className="flex justify-between py-1">
                <dt className="text-muted-foreground">Phone</dt>
                <dd>{booking.guestPhone}</dd>
              </div>
            ) : null}
            {booking.guestEmail ? (
              <div className="flex justify-between py-1">
                <dt className="text-muted-foreground">Email</dt>
                <dd>{booking.guestEmail}</dd>
              </div>
            ) : null}
            {booking.notes ? (
              <div className="flex justify-between py-1">
                <dt className="text-muted-foreground">Notes</dt>
                <dd>{booking.notes}</dd>
              </div>
            ) : null}
          </dl>
        </div>

        {booking.status === "CONFIRMED" && booking.qrCodeToken ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border p-4">
            <h2 className="self-start text-sm font-medium">Check-in QR</h2>
            <BookingQrCode token={booking.qrCodeToken} />
            <RegenerateQrButton bookingId={booking.id} />
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Status</h2>
        <BookingStatusActions bookingId={booking.id} currentStatus={booking.status} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">History</h2>
        <BookingHistoryList history={booking.history} />
      </section>
    </div>
  );
}
