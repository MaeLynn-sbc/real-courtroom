import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { BookingHistoryList } from "@/features/bookings/components/booking-history-list";
import { BookingQrCode } from "@/features/bookings/components/booking-qr-code";
import { BookingSourceBadge } from "@/features/bookings/components/booking-source-badge";
import { BookingStatusActions } from "@/features/bookings/components/booking-status-actions";
import { BookingStatusBadge } from "@/features/bookings/components/booking-status-badge";
import { RecordGcashPaymentForm } from "@/features/bookings/components/record-gcash-payment-form";
import { RegenerateQrButton } from "@/features/bookings/components/regenerate-qr-button";
import { SettleBookingForm } from "@/features/bookings/components/settle-booking-form";
import { SwitchCourtForm } from "@/features/bookings/components/switch-court-form";
import { CoachSessionPanel } from "@/features/coaching/components/coach-session-panel";
import { toSettlementPaymentMethodOptions } from "@/lib/settlement-payment-methods";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { bookingService } from "@/services/booking/booking.service";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachSessionService } from "@/services/coaching/coach-session.service";
import { courtService } from "@/services/court/court.service";
import { saleService } from "@/services/sales/sale.service";

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  hour12: true,
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

  const guestOrPlayerName =
    booking.player?.user.name ?? booking.player?.user.email ?? booking.guestName;

  const [coachSession, allCoaches, availableCoaches, paymentMethods, courts] = await Promise.all([
    coachSessionService.getByBookingId(booking.id),
    coachAvailabilityService.listCoaches(),
    coachAvailabilityService.listAvailableCoaches(booking.startAt, booking.endAt),
    saleService.listPaymentMethods(),
    courtService.listCourts(),
  ]);
  const availableCoachIds = new Set(availableCoaches.map((coach) => coach.id));
  // Cash/GCash only — Pay at Venue (a booking-creation-time concept,
  // never a real settlement; settleBooking's own guard in
  // booking.service.ts rejects it server-side too), Bank Transfer, and
  // Card are excluded by toSettlementPaymentMethodOptions's allowlist.
  const paymentMethodOptions = toSettlementPaymentMethodOptions(paymentMethods);

  // Settle-bill (pay-at-venue gap fix): sale != null is the real "has
  // this been paid" signal, independent of BookingStatus (see
  // getBookingById's own comment). Shown for any booking that isn't
  // paid yet and isn't in one of the terminal/dead states — settling
  // can happen well after check-in, or even after the booking's own
  // time window has passed. Excludes AWAITING_PAYMENT/
  // PENDING_VERIFICATION deliberately: those are the WEBSITE
  // GCash-hold flow's own states, already served by
  // RecordGcashPaymentForm below — showing both would be two competing
  // "record payment" UIs for the same booking.
  const UNSETTLEABLE_STATUSES = new Set([
    "CANCELLED",
    "NO_SHOW",
    "REJECTED",
    "AWAITING_PAYMENT",
    "PENDING_VERIFICATION",
  ]);
  const showSettleForm = !booking.sale && !UNSETTLEABLE_STATUSES.has(booking.status);

  // "Sometimes customer change their mind... rather play in further
  // court" — pre-payment only (changeBookingCourt itself blocks once a
  // Sale exists, same "cancel and rebook instead of a one-off
  // reconciliation" reasoning as that method's own comment). A
  // slightly wider status set than showSettleForm's UNSETTLEABLE_STATUSES
  // deliberately — AWAITING_PAYMENT/PENDING_VERIFICATION are still
  // unpaid holds, switching courts under either is fine.
  const TERMINAL_STATUSES = new Set(["CANCELLED", "NO_SHOW", "REJECTED", "COMPLETED", "REFUNDED"]);
  const showSwitchCourtForm = !booking.sale && !TERMINAL_STATUSES.has(booking.status);

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
          {showSwitchCourtForm ? (
            <div className="mt-2">
              <SwitchCourtForm
                bookingId={booking.id}
                currentCourtId={booking.courtId}
                courts={courts.map((court) => ({ id: court.id, name: court.name }))}
              />
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <BookingSourceBadge source={booking.source} />
          <BookingStatusBadge status={booking.status} />
          {booking.isAfterHours ? <Badge variant="warning">After Hours</Badge> : null}
          {/* "Viewable after approval" (reported live): links straight
              into the proof detail page regardless of status — that page
              already renders an approved/rejected view fine, this was
              the only missing piece (nothing pointed at it once the
              proof left the pending queue). */}
          {booking.paymentProofs[0] ? (
            <Link href={`/dashboard/bookings/verify-payments/${booking.paymentProofs[0].id}`}>
              <Badge
                variant={
                  booking.paymentProofs[0].status === "APPROVED"
                    ? "status"
                    : booking.paymentProofs[0].status === "REJECTED"
                      ? "destructive"
                      : "warning"
                }
                className="cursor-pointer"
              >
                Proof ·{" "}
                {booking.paymentProofs[0].status === "APPROVED"
                  ? "Approved"
                  : booking.paymentProofs[0].status === "REJECTED"
                    ? "Rejected"
                    : "Pending"}
              </Badge>
            </Link>
          ) : null}
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

      {booking.sale ? (
        <section className="rounded-xl border p-4">
          <h2 className="text-sm font-medium">Payment</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {formatCurrency(booking.sale.amountCents)} paid
            {booking.settledVia ? ` via ${booking.settledVia === "GCASH" ? "GCash" : "Cash"}` : ""}
            {booking.settledBy
              ? ` — recorded by ${booking.settledBy.name ?? booking.settledBy.email}${
                  booking.settledAt ? ` at ${dateTimeFormatter.format(booking.settledAt)}` : ""
                }`
              : ""}
            {booking.gcashReference ? ` (ref: ${booking.gcashReference})` : ""}
          </p>
        </section>
      ) : showSettleForm ? (
        <section>
          <SettleBookingForm
            bookingId={booking.id}
            amountCents={booking.totalAmountCents ?? 0}
            paymentMethods={paymentMethodOptions}
          />
        </section>
      ) : null}

      {booking.status === "AWAITING_PAYMENT" ? (
        // A hold waits on the customer submitting proof (BUILD-SPEC.md
        // §8) — no public upload screen exists yet, so this lets staff
        // record it on their behalf (phone/desk). Once submitted, this
        // booking moves to /dashboard/bookings/verify-payments. A coach
        // session may already be attached at this point (added right
        // after the public booking form, before payment — see
        // coach-session.service.ts's createCoachSession, which never
        // gates on Booking.status) — the panel below shows it regardless
        // of where this booking is in the payment lifecycle.
        <section className="flex flex-col gap-3">
          <RecordGcashPaymentForm
            bookingId={booking.id}
            expectedAmountCents={booking.totalAmountCents ?? 0}
          />
        </section>
      ) : null}
      {booking.status === "PENDING_VERIFICATION" ? (
        <p className="text-muted-foreground text-sm">
          Payment submitted — waiting on staff verification. See{" "}
          <Link href="/dashboard/bookings/verify-payments" className="text-primary hover:underline">
            Verify payments
          </Link>
          .
        </p>
      ) : null}

      <section>
        <CoachSessionPanel
          bookingId={booking.id}
          existingSession={coachSession}
          allCoaches={allCoaches}
          availableCoachIds={availableCoachIds}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">History</h2>
        <BookingHistoryList history={booking.history} />
      </section>
    </div>
  );
}
