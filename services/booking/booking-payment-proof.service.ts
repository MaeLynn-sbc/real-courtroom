import type { Booking, BookingPaymentProof, Prisma } from "@/lib/generated/prisma/client";
import { getExpectedPaymentTotalCents } from "@/lib/booking-payment-total";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { bookingService } from "@/services/booking/booking.service";
import { coachSessionService } from "@/services/coaching/coach-session.service";
import { recordCoachSessionFeeSale } from "@/services/coaching/coach-session-fee-sale";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { saleService } from "@/services/sales/sale.service";
import { getSmsService } from "@/services/sms/sms-service.factory";

// Payment-proof verification-outcome SMS — same reasoning as open-play's
// waitlist-invite SMS (services/open-play/open-play-registration.service.ts):
// a customer isn't watching the dashboard the way staff are, so SMS is the
// channel that actually reaches them. Best-effort throughout — a send
// failure is logged, never thrown; the booking/proof state change itself
// is already committed and correct regardless of whether the text lands.
// guestPhone is the only phone this whole proof lifecycle ever has —
// AWAITING_PAYMENT/PENDING_VERIFICATION only exist on the public WEBSITE
// booking path (public-booking.schema.ts requires guestPhone), so it's
// always present in practice; still checked defensively since the column
// itself is nullable.
// Short booking code (2026-08-06) — every guest-facing SMS shows this
// instead of the full bookingReference, easier to read back over the
// phone or off the text itself. Falls back to bookingReference for a
// booking created before the short code existed (shortCode null) or a
// staff-created one (never assigned one at all — see Booking.shortCode's
// own schema comment) — this whole payment-proof flow is customer-facing
// only in practice, so that fallback is a defensive null-guard, not an
// expected everyday case.
function customerFacingCode(booking: { shortCode: string | null; bookingReference: string }): string {
  return booking.shortCode ?? booking.bookingReference;
}

async function sendBookingProofSms(phone: string | null, message: string): Promise<void> {
  if (!phone) {
    return;
  }
  try {
    await getSmsService().send(phone, message);
  } catch (error) {
    logger.error({ error, phone }, "Failed to send booking payment-proof SMS");
  }
}

// Duck-typed check, matching the existing convention (booking.service.ts,
// open-play-checkin.service.ts, locker-rental.service.ts, match.service.ts,
// equipment-rental.service.ts) — avoids importing the generated
// PrismaClientKnownRequestError class just to read one field. Also
// correctly catches a violation of BookingPaymentProof's hand-written
// PARTIAL unique index (prisma/schema.prisma's comment on that model) —
// Prisma maps a Postgres 23505 to P2002 based on the actual database
// error code, not on whether the index was declared via `@unique` in
// schema.prisma, so this check covers both the same way.
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// "hold_expired" removed 2026-08-03: an AWAITING_PAYMENT booking no
// longer stops blocking its court when holdExpiresAt passes (see
// checkAvailabilityWithClient's comment), so a customer submitting
// proof "late" is submitting for a slot that's still genuinely hers —
// there's no reason left to reject it. The WHERE clause below no longer
// checks holdExpiresAt. The constructor's reason param is unused in the
// message now (both remaining cases read the same) but kept for
// call-site documentation — throw new BookingNotAwaitingPaymentError
// ("not_found") still says something a bare no-arg throw wouldn't.
export class BookingNotAwaitingPaymentError extends Error {
  constructor(reason: "not_found" | "wrong_status") {
    // Reworded (2026-08-06, owner feedback: the old wording "isn't
    // waiting for payment" read as awkward, unclear phrasing) — says
    // what's actually true and what to do next, instead of a bare
    // negative statement.
    super(
      "We can't accept a payment screenshot for this booking anymore — it's already been confirmed, rejected, or is no longer available. Check your booking status, or make a new booking if you still need a court.",
    );
    this.name = "BookingNotAwaitingPaymentError";
    void reason;
  }
}

export class DuplicateGcashReferenceError extends Error {
  constructor() {
    super("This GCash reference has already been used for another payment.");
    this.name = "DuplicateGcashReferenceError";
  }
}

export class BookingNotAwaitingVerificationError extends Error {
  constructor() {
    super("This booking isn't waiting for verification.");
    this.name = "BookingNotAwaitingVerificationError";
  }
}

interface ScreenshotInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

// THE PUBLIC PATH HARDCODES ITS OWN PRIVILEGE (same pattern as coaching's
// Gate 3, services/coaching/public-coach-session.ts). `status` below is
// typed as accepted input specifically so a forbidden-value test can
// SEND it — the create() call at the bottom of this method never reads
// it. Whatever a crafted request sends, the stored row is PENDING. This
// is the server refusing it, not the type system declining to have the
// field.
export interface SubmitBookingPaymentProofInput {
  bookingId: string;
  // Optional as long as a screenshot is attached — see this method's
  // own comment on gcashReference below, and the schema's comment on
  // why the column itself is nullable (migration 32).
  gcashReference: string | null;
  submittedAmountCents: number;
  screenshot: ScreenshotInput;
  status?: string;
  resolvedByEmployeeId?: string;
  resolvedAt?: Date;
  rejectionReason?: string;
}

export interface ResolveBookingPaymentProofContext {
  employeeId: string;
  actorUserId: string;
}

export interface ApproveBookingPaymentProofContext extends ResolveBookingPaymentProofContext {
  shiftId: string;
  paymentMethodId: string;
  // Required only when the submitted amount doesn't match
  // getExpectedPaymentTotalCents(booking) — re-checked server-side
  // below, never trusted from the client's own mismatch flag. A
  // matching payment ignores this entirely and keeps today's
  // one-click approve.
  overrideReason?: string;
  // Advisory duplicate-guest warning (2026-08-06 incident) — required
  // only when findOverlappingBookingForGuest actually finds one,
  // re-checked server-side below, same "never trust the client's own
  // flag" shape as overrideReason above.
  duplicateOverrideReason?: string;
}

export interface ResolveBookingPaymentProofResult {
  alreadyResolved: boolean;
  proof: BookingPaymentProof;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

export class BookingPaymentProofService {
  // Reachable from the public submission action with NO session and NO
  // employee context — every trusted value below (status=PENDING, the
  // booking-status transition target) is hardcoded in this method, never
  // taken from the caller.
  async submitBookingPaymentProof(
    input: SubmitBookingPaymentProofInput,
  ): Promise<BookingPaymentProof> {
    const upload = await getUploadService().uploadPrivate({
      fileName: input.screenshot.fileName,
      contentType: input.screenshot.contentType,
      data: input.screenshot.data,
    });

    try {
      const { proof, bookedById, guestPhone, customerCode } = await prisma.$transaction(
        async (tx) => {
          // Atomic conditional UPDATE (§15 pattern 2) — the WHERE clause IS
          // the check: only a booking that is STILL AWAITING_PAYMENT can be
          // moved. No holdExpiresAt check here (removed 2026-08-03, see
          // BookingNotAwaitingPaymentError's own comment) — a booking stays
          // AWAITING_PAYMENT and blocks its court indefinitely regardless of
          // how long ago the hold's display timer ran out, so a "late"
          // submission is still submitting for a slot that's genuinely
          // hers. A concurrent second submission for the same booking
          // (double-tap) affects 0 rows here and is rejected below, instead
          // of racing to create two PENDING proof rows for one booking.
          const updateResult = await tx.booking.updateMany({
            where: { id: input.bookingId, status: "AWAITING_PAYMENT" },
            data: { status: "PENDING_VERIFICATION", holdExpiresAt: null },
          });

          if (updateResult.count === 0) {
            const booking = await tx.booking.findUnique({ where: { id: input.bookingId } });
            if (!booking) {
              throw new BookingNotAwaitingPaymentError("not_found");
            }
            throw new BookingNotAwaitingPaymentError("wrong_status");
          }

          // No real signed-in actor exists for an unauthenticated public
          // submission — attribute the audit trail to the same seeded
          // Website system identity the booking itself is already
          // attributed to (Booking.bookedById), not a made-up value.
          // Also the source for expectedAmountCents below — fetched once,
          // with coachSession, and reused for both.
          const booking = await tx.booking.findUniqueOrThrow({
            where: { id: input.bookingId },
            include: { coachSession: true },
          });

          // Hardcoded — see this method's own doc comment. input.status /
          // input.resolvedByEmployeeId / input.resolvedAt / input.
          // rejectionReason are never read here, on purpose.
          // expectedAmountCents: frozen HERE, in the same transaction as
          // submittedAmountCents — see the column's own schema comment
          // for why this must never be recomputed after insert.
          const created = await tx.bookingPaymentProof.create({
            data: {
              bookingId: input.bookingId,
              gcashReference: input.gcashReference,
              submittedAmountCents: input.submittedAmountCents,
              expectedAmountCents: getExpectedPaymentTotalCents(booking),
              screenshotStorageKey: upload.key,
              status: "PENDING",
            },
          });

          return {
            proof: created,
            bookedById: booking.bookedById,
            guestPhone: booking.guestPhone,
            customerCode: customerFacingCode(booking),
          };
        },
      );

      await this.writeBookingHistory(input.bookingId, "PENDING_VERIFICATION", bookedById);
      await this.writeAuditLog({
        actorUserId: bookedById,
        action: "booking_payment_proof.submitted",
        entityType: "BookingPaymentProof",
        entityId: proof.id,
        newValues: proof,
      });

      // Submission acknowledgment — confirms the screenshot itself was
      // received before staff ever look at it, so the customer isn't
      // left wondering whether the upload went through. Reworded per
      // the booking-flow wording sweep (2026-08-03): says what IS true
      // (the court is reserved — it's already secured server-side the
      // instant this transaction commits, see submitBookingPaymentProof's
      // updateMany above, which clears holdExpiresAt entirely so nothing
      // can release this slot to anyone else) rather than leading with
      // "not yet confirmed," which read to customers as still-at-risk —
      // especially anyone who booked overnight with no staff on shift to
      // review it for hours. Payment verification (staff-checked, still
      // required before CONFIRMED — see approveBookingPaymentProof) is
      // a separate concern from whether the court itself is held.
      await sendBookingProofSms(
        guestPhone,
        `The Courtroom: Got your payment screenshot for booking ${customerCode} — your court is reserved. We'll text you once payment is confirmed. Check your booking anytime: thecourtroomkalibo.com/lookup`,
      );

      return proof;
    } catch (error) {
      // The upload already landed — clean it up rather than leaving an
      // orphaned file for a submission that never became a real proof row.
      await getUploadService()
        .delete(upload.key)
        .catch(() => undefined);

      if (isUniqueConstraintViolation(error)) {
        throw new DuplicateGcashReferenceError();
      }
      throw error;
    }
  }

  // Concurrency-safe the same way settleTab/writeOffTab already are (§15
  // pattern 2): the status-guarded updateMany IS the guard, not a
  // Serializable retry loop — this invariant is expressible as one row's
  // WHERE clause. Two staff approving the same proof at once: exactly one
  // updateMany affects a row and proceeds to create the Sale; the other
  // affects 0 rows, re-reads the now-committed row, and returns it as a
  // benign no-op — never a raw DB error, never two Sales.
  // GCash reference removed from the customer-facing upload (the
  // screenshot is the actual proof) — this is the staff-side
  // replacement: record one manually at verification, e.g. after
  // texting/calling the customer to ask for it, or reading it off the
  // screenshot themselves. PENDING-only, same as approve/reject below —
  // once resolved, the proof is history, not something to keep editing.
  // Goes through the same partial unique index every other reference
  // write does (BookingPaymentProof_gcashReference_active_key) — a
  // staff-entered duplicate is rejected exactly like a customer-entered
  // one would have been.
  async recordGcashReference(
    proofId: string,
    gcashReference: string,
    actorUserId: string,
  ): Promise<BookingPaymentProof> {
    const trimmed = gcashReference.trim();
    if (!trimmed) {
      throw new Error("Enter a reference number.");
    }

    const existing = await prisma.bookingPaymentProof.findUniqueOrThrow({ where: { id: proofId } });
    if (existing.status !== "PENDING") {
      throw new Error(
        `Can only record a reference on a payment still awaiting verification (current status: ${existing.status.toLowerCase()}).`,
      );
    }

    const updated = await prisma.bookingPaymentProof.update({
      where: { id: proofId },
      data: { gcashReference: trimmed },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "booking_payment_proof.reference_recorded",
      entityType: "BookingPaymentProof",
      entityId: proofId,
      oldValues: { gcashReference: existing.gcashReference },
      newValues: { gcashReference: trimmed },
    });

    return updated;
  }

  async approveBookingPaymentProof(
    proofId: string,
    context: ApproveBookingPaymentProofContext,
  ): Promise<ResolveBookingPaymentProofResult> {
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.bookingPaymentProof.updateMany({
        where: { id: proofId, status: "PENDING" },
        data: { status: "APPROVED", resolvedByEmployeeId: context.employeeId, resolvedAt: now },
      });

      const proof = await tx.bookingPaymentProof.findUniqueOrThrow({ where: { id: proofId } });

      if (updateResult.count === 0) {
        return { alreadyResolved: true as const, proof, booking: null, sale: null };
      }

      const booking = await tx.booking.findUniqueOrThrow({
        where: { id: proof.bookingId },
        include: { coachSession: { include: { coach: true } } },
      });
      if (booking.status !== "PENDING_VERIFICATION") {
        throw new BookingNotAwaitingVerificationError();
      }

      // Advisory duplicate-guest check (2026-08-06 incident, Freah): the
      // client guard + idempotency key stop a duplicate booking being
      // CREATED, but nothing previously warned staff before they approved
      // a SECOND booking for the same guest and overlapping slot — exactly
      // what happened here, approved 58 seconds apart by two different
      // staff. Advisory, not blocking: a match just requires a real
      // reason, same shape as the amount-mismatch guard directly below.
      const duplicate = await bookingService.findOverlappingBookingForGuest(
        booking.id,
        booking.guestName,
        booking.guestPhone,
        booking.startAt,
        booking.endAt,
        tx,
      );
      if (duplicate && !context.duplicateOverrideReason?.trim()) {
        throw new Error(
          `A reason is required to approve this booking — ${booking.guestName ?? "this guest"} already has another booking (${duplicate.bookingReference}) for an overlapping time on ${duplicate.courtName}.`,
        );
      }

      // Re-derived server-side from the booking itself, not trusted from
      // whatever mismatch flag the client sent — the same amount the
      // verification screen already shows as "Expected"
      // (lib/booking-payment-total.ts's getExpectedPaymentTotalCents).
      // A blank/whitespace-only reason on a genuine mismatch is
      // rejected the same way rejectBookingPaymentProof already
      // requires a real rejection reason below.
      const expectedAmountCents = getExpectedPaymentTotalCents(booking);
      if (proof.submittedAmountCents !== expectedAmountCents && !context.overrideReason?.trim()) {
        throw new Error(
          "A reason is required to approve a payment that doesn't match the expected amount.",
        );
      }

      const confirmedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: { status: "CONFIRMED" },
      });

      const sale = await saleService.createSale(
        {
          category: "BOOKING",
          source: "WEBSITE",
          amountCents: booking.totalAmountCents ?? 0,
          paymentMethodId: context.paymentMethodId,
          employeeId: context.employeeId,
          shiftId: context.shiftId,
          playerId: booking.playerId,
          bookingId: booking.id,
        },
        tx,
      );

      // Same combined GCash payment, split into a second Sale — see
      // coach-session-fee-sale.ts's own comment for why this is its own
      // Sale (category COACHING) rather than folded into the amount
      // above. Created in the SAME transaction as the court Sale, not
      // after commit — both are real revenue rows that must land
      // atomically together.
      const coachingSale =
        booking.coachSession && booking.coachSession.status !== "CANCELLED"
          ? await recordCoachSessionFeeSale(
              {
                coachSessionId: booking.coachSession.id,
                rateCents: booking.coachSession.rateCents,
                paymentMethodId: context.paymentMethodId,
                employeeId: context.employeeId,
                shiftId: context.shiftId,
                playerId: booking.playerId,
              },
              tx,
            )
          : null;

      return {
        alreadyResolved: false as const,
        proof,
        booking: confirmedBooking,
        sale,
        coachingSale,
      };
    });

    if (!result.alreadyResolved) {
      await this.writeBookingHistory(result.booking.id, "CONFIRMED", context.actorUserId);
      await this.writeAuditLog({
        actorUserId: context.actorUserId,
        action: "booking_payment_proof.approved",
        entityType: "BookingPaymentProof",
        entityId: result.proof.id,
        // overrideReason/duplicateOverrideReason folded into the same
        // JSON blob rather than new columns on BookingPaymentProof — this
        // audit row is already the record of who approved this proof and
        // when; both override reasons belong right next to that, not in
        // a separate table.
        newValues: {
          ...result.proof,
          overrideReason: context.overrideReason?.trim() || null,
          duplicateOverrideReason: context.duplicateOverrideReason?.trim() || null,
        },
      });
      await saleService.logSaleCreated(result.sale, context.actorUserId);
      if (result.coachingSale) {
        await saleService.logSaleCreated(result.coachingSale, context.actorUserId);
      }
      await sendBookingProofSms(
        result.booking.guestPhone,
        `The Courtroom: Your booking ${customerFacingCode(result.booking)} is CONFIRMED! See you on the court. Check your booking anytime: thecourtroomkalibo.com/lookup`,
      );
    }

    return { alreadyResolved: result.alreadyResolved, proof: result.proof };
  }

  // Same concurrency shape as approve, above — status-guarded updateMany,
  // no Serializable retry needed.
  async rejectBookingPaymentProof(
    proofId: string,
    reason: string,
    context: ResolveBookingPaymentProofContext,
  ): Promise<ResolveBookingPaymentProofResult> {
    if (!reason.trim()) {
      // Same "no anonymous write-offs" shape as PlayerTab's write-off
      // reason — required, checked here at the service boundary.
      throw new Error("A rejection reason is required.");
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.bookingPaymentProof.updateMany({
        where: { id: proofId, status: "PENDING" },
        data: {
          status: "REJECTED",
          resolvedByEmployeeId: context.employeeId,
          resolvedAt: now,
          rejectionReason: reason,
        },
      });

      const proof = await tx.bookingPaymentProof.findUniqueOrThrow({ where: { id: proofId } });

      if (updateResult.count === 0) {
        return { alreadyResolved: true as const, proof, booking: null };
      }

      const booking = await tx.booking.findUniqueOrThrow({ where: { id: proof.bookingId } });
      if (booking.status !== "PENDING_VERIFICATION") {
        throw new BookingNotAwaitingVerificationError();
      }

      // Terminal, same as CANCELLED — the slot is free for anyone
      // (including this same customer, on a new booking) the instant this
      // commits. No expiry field to clear: PENDING_VERIFICATION bookings
      // already have holdExpiresAt=null (cleared at submission).
      const rejectedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: { status: "REJECTED" },
      });

      return { alreadyResolved: false as const, proof, booking: rejectedBooking };
    });

    if (!result.alreadyResolved) {
      await this.writeBookingHistory(result.booking.id, "REJECTED", context.actorUserId, reason);
      await this.writeAuditLog({
        actorUserId: context.actorUserId,
        action: "booking_payment_proof.rejected",
        entityType: "BookingPaymentProof",
        entityId: result.proof.id,
        newValues: result.proof,
      });

      // Merge-time fix (Coaching x Phase 8): booking.service.ts's
      // updateBookingStatus already does this exact cascade for CANCELLED
      // — REJECTED is the same kind of terminal, slot-freeing outcome
      // (see the comment two blocks up: "same as CANCELLED"), but this
      // path sets status via its own direct tx.booking.update rather than
      // going through updateBookingStatus, so it never inherited that
      // cascade. Without this, a coach attached to a booking whose GCash
      // proof got rejected would stay CONFIRMED forever — permanently
      // occupying that coach's slot for a court booking that never
      // happened. createCoachSession never checks Booking.status when it
      // attaches (services/coaching/coach-session.service.ts), so nothing
      // else would have caught this.
      const coachSession = await prisma.coachSession.findUnique({
        where: { bookingId: result.booking.id },
      });
      if (coachSession && coachSession.status !== "CANCELLED") {
        await coachSessionService.cancelCoachSession(
          coachSession.id,
          context.actorUserId,
          "Parent court booking's payment was rejected.",
        );
      }

      // No customer-facing status page shows rejectionReason anywhere in
      // this app yet (confirmed: app/lookup/page.tsx doesn't even query
      // BookingPaymentProof) — this SMS is the first place a customer
      // ever sees it, not a second copy of existing text. REJECTED is
      // terminal (same as CANCELLED, per the comment above) — a customer
      // cannot resubmit proof for THIS booking, only make a new one,
      // stated plainly rather than implying a resubmit step that doesn't
      // exist.
      await sendBookingProofSms(
        result.booking.guestPhone,
        `The Courtroom: We couldn't verify your GCash payment for booking ${customerFacingCode(result.booking)} — ${reason}. This booking has been cancelled; please make a new booking if you'd still like to play, or contact us for help. Check your booking anytime: thecourtroomkalibo.com/lookup`,
      );
    }

    return { alreadyResolved: result.alreadyResolved, proof: result.proof };
  }

  // Reported live (Bea Señeris, BK-20260804-0002): this query never
  // fetched coachSession, so the verification queue's own "Expected"
  // fell back to Booking.totalAmountCents (court hire only) — a
  // different, understated number than the detail screen's
  // getExpectedPaymentTotalCents(booking), which DOES see the coach
  // add-on. Same include shape as getProofById below, so both screens
  // now compute Expected from the exact same data.
  async listPendingProofs() {
    return prisma.bookingPaymentProof.findMany({
      where: { status: "PENDING" },
      include: { booking: { include: { court: true, coachSession: true } } },
      orderBy: { submittedAt: "asc" },
    });
  }

  // Gate 3: the dashboard-wide badge. A separate, lighter query than
  // listPendingProofs — the badge needs a number on every page load, not
  // the full row set.
  async countPendingProofs(): Promise<number> {
    return prisma.bookingPaymentProof.count({ where: { status: "PENDING" } });
  }

  async getProofById(proofId: string) {
    return prisma.bookingPaymentProof.findUnique({
      where: { id: proofId },
      include: {
        booking: {
          include: {
            court: true,
            // history included for the detail screen's "what changed and
            // when" line — only ever rendered when expectedAmountCents
            // (the submission-time snapshot) disagrees with the live
            // total, to explain the divergence rather than just flag it.
            coachSession: { include: { coach: true, history: { orderBy: { createdAt: "desc" } } } },
          },
        },
        resolvedByEmployee: true,
      },
    });
  }

  // The mismatch-approval reason isn't a column on BookingPaymentProof
  // (see approveBookingPaymentProof's own comment) — it's read back from
  // the same audit log row the approval itself wrote, so anyone
  // reviewing this proof later sees why a mismatched amount was
  // approved without having to separately go dig through Audit Logs.
  async getApprovalOverrideReason(proofId: string): Promise<string | null> {
    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "BookingPaymentProof",
        entityId: proofId,
        action: "booking_payment_proof.approved",
      },
      orderBy: { createdAt: "desc" },
    });
    const newValues = entry?.newValues as { overrideReason?: string | null } | null | undefined;
    return newValues?.overrideReason ?? null;
  }

  // Mirrors getApprovalOverrideReason exactly — same audit log row, the
  // sibling field written alongside overrideReason above.
  async getDuplicateOverrideReason(proofId: string): Promise<string | null> {
    const entry = await prisma.auditLog.findFirst({
      where: {
        entityType: "BookingPaymentProof",
        entityId: proofId,
        action: "booking_payment_proof.approved",
      },
      orderBy: { createdAt: "desc" },
    });
    const newValues = entry?.newValues as { duplicateOverrideReason?: string | null } | null | undefined;
    return newValues?.duplicateOverrideReason ?? null;
  }

  private async writeBookingHistory(
    bookingId: string,
    status: Booking["status"],
    changedById: string | null,
    note?: string,
  ): Promise<void> {
    await prisma.bookingHistory.create({
      data: { bookingId, status, changedById, note },
    });
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const bookingPaymentProofService = new BookingPaymentProofService();
