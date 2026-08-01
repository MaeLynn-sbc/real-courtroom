import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
type BookingRow = Bookings[number];

interface BookingListProps {
  bookings: Bookings;
}

// Narrowed to exactly what the payment-state derivation reads, not the
// full Prisma row — keeps this function testable with plain fixtures
// and independent of whatever else the list query happens to include.
export interface BookingPaymentInfo {
  status: BookingRow["status"];
  sale: { createdAt: Date } | null;
  settledAt: Date | null;
  holdExpiresAt: Date | null;
  paymentProofs: { id: string; status: string; submittedAt: Date; resolvedAt: Date | null }[];
}

// Payment column (reported live): "has this been paid" is sale != null
// (see Booking.sale's own comment in the schema, and getBookingById's
// identical convention) — never inferred from BookingStatus.PAID, which
// this app doesn't actually use as the source of truth. Falls through in
// priority order: a real Sale always wins (a booking can reach
// AWAITING_PAYMENT's hold-expired state and still get paid at the desk
// afterward — the Sale is what actually happened), then the GCash-hold
// states, then the two payment-adjacent terminal statuses, then plain
// unpaid/pay-at-venue as the default for every other live status.
export function getBookingPaymentState(
  booking: BookingPaymentInfo,
  now: Date,
): { label: string; variant: "status" | "warning" | "destructive" | "outline"; when: Date | null } {
  if (booking.sale) {
    return { label: "Paid", variant: "status", when: booking.settledAt ?? booking.sale.createdAt };
  }
  if (booking.status === "PENDING_VERIFICATION") {
    return {
      label: "Awaiting verification",
      variant: "warning",
      when: booking.paymentProofs[0]?.submittedAt ?? null,
    };
  }
  if (booking.status === "AWAITING_PAYMENT") {
    const expired =
      booking.holdExpiresAt != null && booking.holdExpiresAt.getTime() < now.getTime();
    return expired
      ? { label: "Hold expired", variant: "destructive", when: booking.holdExpiresAt }
      : { label: "Awaiting payment", variant: "warning", when: booking.holdExpiresAt };
  }
  if (booking.status === "REJECTED") {
    return {
      label: "Payment rejected",
      variant: "destructive",
      when: booking.paymentProofs[0]?.resolvedAt ?? null,
    };
  }
  if (booking.status === "REFUNDED") {
    return { label: "Refunded", variant: "destructive", when: booking.settledAt };
  }
  return { label: "Unpaid — pay at venue", variant: "outline", when: null };
}

function PaymentCell({ booking }: { booking: BookingRow }) {
  const state = getBookingPaymentState(booking, new Date());
  const proof = booking.paymentProofs[0];

  const badge = (
    <Badge variant={state.variant} className={proof ? "cursor-pointer" : undefined}>
      {state.label}
    </Badge>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {/* Requirement 3: a proof-linked row opens the screenshot straight
          from the list, no need to open the booking first — same detail
          page the booking-detail badge already points at, which already
          renders fine for any status (see getProofById's own comment). */}
      {proof ? (
        <Link
          href={`/dashboard/bookings/verify-payments/${proof.id}`}
          className="inline-flex w-fit"
        >
          {badge}
        </Link>
      ) : (
        badge
      )}
      {state.when ? (
        <span
          title={dateTimeFormatter.format(state.when)}
          className="text-muted-foreground text-xs"
        >
          {formatRelativeTime(state.when)}
        </span>
      ) : null}
    </div>
  );
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
          <TableHead>Payment</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bookings.map((booking) => (
          <TableRow key={booking.id}>
            <TableCell>
              <Link
                href={`/dashboard/bookings/${booking.id}`}
                className="font-medium hover:underline"
              >
                {booking.bookingReference}
              </Link>
            </TableCell>
            <TableCell>{booking.court.name}</TableCell>
            <TableCell>{booking.player?.user.name ?? booking.guestName ?? "—"}</TableCell>
            <TableCell>
              {dateTimeFormatter.format(booking.startAt)} –{" "}
              {dateTimeFormatter.format(booking.endAt)}
            </TableCell>
            <TableCell>
              <span
                title={dateTimeFormatter.format(booking.createdAt)}
                className="text-muted-foreground text-sm"
              >
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
            <TableCell>
              <PaymentCell booking={booking} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
