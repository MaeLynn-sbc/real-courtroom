import {
  bookingService,
  type CreateBookingHoldInput,
} from "@/services/booking/booking.service";
import { getWebsiteBookingContext } from "@/services/booking/website-identity";
import { settingsService } from "@/services/settings/settings.service";
import type { CreateBookingInput } from "@/features/bookings/schemas/booking.schema";

export interface CreatePublicBookingInput {
  courtId: string;
  startAt: Date;
  endAt: Date;
  guestName: string;
  guestPhone: string;
  idempotencyKey?: string;
}

export interface CreatePublicBookingResult {
  bookingId: string;
  bookingReference: string;
  // Customer-facing short code (see Booking.shortCode's own schema
  // comment) — always set here, since both bookingService.createBooking
  // (WEBSITE source) and createBookingHold generate one for every
  // public booking. Kept as its own field rather than replacing
  // bookingReference so nothing here has to guess which one a caller
  // wants; the confirmation screen shows both.
  shortCode: string | null;
  requiresPayment: boolean;
  holdExpiresAt?: Date;
  // Already computed and persisted by bookingService.createBooking/
  // createBookingHold (pro-rata, hourlyRateCents * durationHours) — just
  // surfaced here so the confirmation screen can show what was actually
  // charged, instead of the customer never seeing a price at all.
  totalAmountCents: number;
}

// Extracted from actions/public-booking.actions.ts so this — the actual
// decision logic, including THE hard boundary switch check — is callable
// directly from an integration test. next/cache's revalidatePath throws
// ("static generation store missing") outside a real Next.js request
// context, so it can't live in a function a plain tsx script calls; it
// stays in the thin action wrapper, which does nothing else but rate-
// limit, call this, and revalidate. Same split this session already
// established for coaching's public path
// (services/coaching/public-coach-session.ts).
export async function createPublicBooking(input: CreatePublicBookingInput): Promise<CreatePublicBookingResult> {
  const context = await getWebsiteBookingContext();

  // THE hard boundary. Read fresh on every call (never cached), and
  // checked here, in ONE place — no other code path decides this
  // independently. Default is ON as of commit 65818b6 (2026-07-28) —
  // settingsService.getBookingRequirePrepayment's own "absence of a row
  // means true" — so a fresh install requires GCash prepayment unless an
  // owner explicitly flips it off; only then does execution take the
  // `else` branch below: the exact same call to bookingService.
  // createBooking(), with the exact same bookingInput shape, that ran
  // before this phase existed. createBooking's own source is untouched by
  // this whole phase; only this branch is new. Owner report (2026-08-15):
  // when this branch DOES run, the resulting PAY_AT_VENUE Sale is
  // invisible to cash/GCash reconciliation until corrected — see
  // features/bookings/components/correct-sale-payment-method-form.tsx.
  const requiresPrepayment = await settingsService.getBookingRequirePrepayment();

  if (requiresPrepayment) {
    const holdInput: CreateBookingHoldInput = {
      courtId: input.courtId,
      type: "HOURLY",
      startAt: input.startAt,
      endAt: input.endAt,
      guestName: input.guestName,
      guestPhone: input.guestPhone,
      idempotencyKey: input.idempotencyKey,
    };

    const hold = await bookingService.createBookingHold(holdInput, context.userId);

    return {
      bookingId: hold.id,
      bookingReference: hold.bookingReference,
      shortCode: hold.shortCode,
      requiresPayment: true,
      holdExpiresAt: hold.holdExpiresAt ?? undefined,
      totalAmountCents: hold.totalAmountCents ?? 0,
    };
  }

  // Every field here is already validated by the caller (publicBookingSchema)
  // or computed by it (startAt/endAt). The payment method itself
  // (the real seeded "Pay at Venue" id, not customer input) is passed
  // separately below, in saleContext — CreateBookingInput itself never
  // carried payment info structurally (settle-bill gap fix removed the
  // staff form's own redundant copy of it too).
  const bookingInput: CreateBookingInput = {
    courtId: input.courtId,
    type: "HOURLY",
    startAt: input.startAt,
    endAt: input.endAt,
    guestName: input.guestName,
    guestPhone: input.guestPhone,
  };

  const booking = await bookingService.createBooking(bookingInput, context.userId, {
    employeeId: context.employeeId,
    shiftId: context.shiftId,
    paymentMethodId: context.paymentMethodId,
    source: "WEBSITE",
  });

  return {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    shortCode: booking.shortCode,
    requiresPayment: false,
    totalAmountCents: booking.totalAmountCents ?? 0,
  };
}
