import type { OpenPlayRegistrationPaymentProof } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  createOpenPlayRegistrationFeeSale,
  openPlayRegistrationService,
  type RegisterWalkInSaleContext,
} from "@/services/open-play/open-play-registration.service";
import { getUploadService } from "@/services/upload/upload-service.factory";
import { smsDate, smsTimeRange, smsTruncateReason } from "@/lib/sms-format";
import { openPlayConfirmationBody } from "@/lib/sms-templates";
import { getSmsService } from "@/services/sms/sms-service.factory";
import { smsDispatchService } from "@/services/sms/sms-dispatch.service";

// Mirrors services/booking/booking-payment-proof.service.ts's exact shape
// — same three states (submit / approve / reject), same concurrency
// pattern (§15 pattern 2, a status-guarded updateMany as the guard
// itself, not a check-then-act), same public-path-hardcodes-its-own-
// privilege convention for submission. Gate 1 built the
// OpenPlayRegistrationPaymentProof model; nothing referenced it until
// now (confirmed: zero non-schema hits anywhere in the repo).

export class OpenPlayRegistrationNotAwaitingPaymentError extends Error {
  constructor(reason: "not_found" | "wrong_status" | "hold_expired") {
    super(
      reason === "hold_expired"
        ? "This registration's hold has expired — please submit a new registration."
        : "This registration isn't waiting for payment.",
    );
    this.name = "OpenPlayRegistrationNotAwaitingPaymentError";
  }
}

export class OpenPlayRegistrationNotAwaitingVerificationError extends Error {
  constructor() {
    super("This registration isn't waiting for verification.");
    this.name = "OpenPlayRegistrationNotAwaitingVerificationError";
  }
}

interface ScreenshotInput {
  fileName: string;
  contentType: string;
  data: Buffer;
}

// THE PUBLIC PATH HARDCODES ITS OWN PRIVILEGE — same convention as
// SubmitBookingPaymentProofInput's own comment. status/resolvedByEmployeeId/
// resolvedAt/rejectionReason are typed as accepted input specifically so a
// forbidden-value test can SEND them; submitOpenPlayRegistrationPaymentProof
// never reads any of it.
export interface SubmitOpenPlayRegistrationPaymentProofInput {
  registrationId: string;
  // Optional, matching BookingPaymentProof's own gcashReference (see
  // that service's comment) — the screenshot is the actual proof.
  gcashReference: string | null;
  submittedAmountCents: number;
  screenshot: ScreenshotInput;
  status?: string;
  resolvedByEmployeeId?: string;
  resolvedAt?: Date;
  rejectionReason?: string;
}

export interface ResolveOpenPlayRegistrationPaymentProofContext {
  employeeId: string;
  actorUserId: string;
}

export interface ApproveOpenPlayRegistrationPaymentProofContext extends ResolveOpenPlayRegistrationPaymentProofContext {
  shiftId: string;
  paymentMethodId: string;
}

export interface ResolveOpenPlayRegistrationPaymentProofResult {
  alreadyResolved: boolean;
  proof: OpenPlayRegistrationPaymentProof;
}

// Same best-effort, log-don't-throw SMS shape as
// services/booking/booking-payment-proof.service.ts's sendBookingProofSms
// and open-play's own waitlist-invite SMS.
async function sendOpenPlayProofSms(phone: string | null, message: string): Promise<void> {
  if (!phone) {
    return;
  }
  try {
    await getSmsService().send(phone, message);
  } catch (error) {
    logger.error({ error, phone }, "Failed to send open-play payment-proof SMS");
  }
}

export class OpenPlayRegistrationPaymentProofService {
  // Reachable from the public submission action with no session/employee
  // context — same shape as submitBookingPaymentProof.
  async submitOpenPlayRegistrationPaymentProof(
    input: SubmitOpenPlayRegistrationPaymentProofInput,
  ): Promise<OpenPlayRegistrationPaymentProof> {
    const upload = await getUploadService().uploadPrivate({
      fileName: input.screenshot.fileName,
      contentType: input.screenshot.contentType,
      data: input.screenshot.data,
    });

    try {
      const { proof, phone, playerName } = await prisma.$transaction(async (tx) => {
        const now = new Date();
        // Atomic conditional UPDATE (§15 pattern 2), identical shape to
        // submitBookingPaymentProof's own guard.
        const updateResult = await tx.openPlayNightRegistration.updateMany({
          where: { id: input.registrationId, status: "AWAITING_PAYMENT", holdExpiresAt: { gte: now } },
          data: { status: "PENDING_VERIFICATION", holdExpiresAt: null },
        });

        if (updateResult.count === 0) {
          const registration = await tx.openPlayNightRegistration.findUnique({ where: { id: input.registrationId } });
          if (!registration) {
            throw new OpenPlayRegistrationNotAwaitingPaymentError("not_found");
          }
          if (registration.status === "AWAITING_PAYMENT") {
            throw new OpenPlayRegistrationNotAwaitingPaymentError("hold_expired");
          }
          throw new OpenPlayRegistrationNotAwaitingPaymentError("wrong_status");
        }

        // Hardcoded — see this method's own doc comment above the input
        // type. input.status/resolvedByEmployeeId/resolvedAt/rejectionReason
        // are never read here.
        const created = await tx.openPlayRegistrationPaymentProof.create({
          data: {
            registrationId: input.registrationId,
            gcashReference: input.gcashReference,
            submittedAmountCents: input.submittedAmountCents,
            screenshotStorageKey: upload.key,
            status: "PENDING",
          },
        });

        const registration = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: input.registrationId } });
        return { proof: created, phone: registration.phone, playerName: registration.playerName };
      });

      await this.writeAuditLog({
        actorUserId: null,
        action: "open_play_registration_payment_proof.submitted",
        entityType: "OpenPlayRegistrationPaymentProof",
        entityId: proof.id,
        newValues: proof,
      });

      // Submission acknowledgment — this is the FIRST self-service
      // (public, unauthenticated) proof upload this app has; there is no
      // staff-in-the-room moment to reassure the customer otherwise.
      await sendOpenPlayProofSms(
        phone,
        `Hi ${playerName}, we received your GCash payment for Open Play. We're verifying it now and will text you once it's confirmed.`,
      );

      return proof;
    } catch (error) {
      // The upload already landed — clean it up rather than leaving an
      // orphaned file for a submission that never became a real proof row.
      // NOTE (accepted gap, carried over from Gate 1's own report):
      // unlike BookingPaymentProof's hand-written partial unique index,
      // OpenPlayRegistrationPaymentProof.gcashReference has no unique
      // index at all yet — so, unlike submitBookingPaymentProof, there is
      // genuinely no duplicate-reference detection to map here. A GCash
      // reference could be reused across two open-play registrations (or
      // across an open-play registration and a court booking) without
      // either table's index catching it.
      await getUploadService().delete(upload.key).catch(() => undefined);
      throw error;
    }
  }

  // GCash reference removed from the customer-facing upload (the
  // screenshot is the actual proof) — mirrors
  // bookingPaymentProofService.recordGcashReference exactly. PENDING-only:
  // once resolved, the proof is history, not something to keep editing.
  async recordGcashReference(
    proofId: string,
    gcashReference: string,
    actorUserId: string,
  ): Promise<OpenPlayRegistrationPaymentProof> {
    const trimmed = gcashReference.trim();
    if (!trimmed) {
      throw new Error("Enter a reference number.");
    }

    const existing = await prisma.openPlayRegistrationPaymentProof.findUniqueOrThrow({ where: { id: proofId } });
    if (existing.status !== "PENDING") {
      throw new Error(`Can only record a reference on a payment still awaiting verification (current status: ${existing.status.toLowerCase()}).`);
    }

    const updated = await prisma.openPlayRegistrationPaymentProof.update({
      where: { id: proofId },
      data: { gcashReference: trimmed },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "open_play_registration_payment_proof.reference_recorded",
      entityType: "OpenPlayRegistrationPaymentProof",
      entityId: proofId,
      newValues: { gcashReference: trimmed, previousGcashReference: existing.gcashReference },
    });

    return updated;
  }

  // Same concurrency shape as approveBookingPaymentProof — the
  // status-guarded updateMany IS the guard.
  async approveOpenPlayRegistrationPaymentProof(
    proofId: string,
    context: ApproveOpenPlayRegistrationPaymentProofContext,
  ): Promise<ResolveOpenPlayRegistrationPaymentProofResult> {
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.openPlayRegistrationPaymentProof.updateMany({
        where: { id: proofId, status: "PENDING" },
        data: { status: "APPROVED", resolvedByEmployeeId: context.employeeId, resolvedAt: now },
      });

      const proof = await tx.openPlayRegistrationPaymentProof.findUniqueOrThrow({ where: { id: proofId } });

      if (updateResult.count === 0) {
        return { alreadyResolved: true as const, proof, registration: null };
      }

      const registration = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: proof.registrationId } });
      if (registration.status !== "PENDING_VERIFICATION") {
        throw new OpenPlayRegistrationNotAwaitingVerificationError();
      }

      const confirmedRegistration = await tx.openPlayNightRegistration.update({
        where: { id: registration.id },
        data: { status: "CONFIRMED" },
      });

      // Shared mechanism (Gate 2 review follow-up's own instruction: "both
      // paths — existing walk-in, new online-invite/proof-confirm — share
      // one mechanism, not a second, diverging one"). Same fee, same
      // Sale shape, just attributed with GCASH + the reference the
      // customer actually submitted instead of a staff-entered cash/GCash
      // choice.
      const saleContext: RegisterWalkInSaleContext = {
        method: "GCASH",
        gcashReference: proof.gcashReference,
        paymentMethodId: context.paymentMethodId,
        employeeId: context.employeeId,
        shiftId: context.shiftId,
      };
      await createOpenPlayRegistrationFeeSale(tx, confirmedRegistration, saleContext);

      return { alreadyResolved: false as const, proof, registration: confirmedRegistration };
    });

    if (!result.alreadyResolved) {
      await this.writeAuditLog({
        actorUserId: context.actorUserId,
        action: "open_play_registration_payment_proof.approved",
        entityType: "OpenPlayRegistrationPaymentProof",
        entityId: result.proof.id,
        newValues: result.proof,
      });
      // Trigger 1 (owner decision, 2026-08-28): fires at payment approval,
      // matching the court-booking rule — a registration sitting at
      // AWAITING_PAYMENT is not yet a confirmed seat.
      //
      // PUBLIC path only. registerWalkIn and registerWeeknightWalkIn
      // deliberately send nothing: 852 of 864 walk-in registrations carry
      // an unsendable phone (831 of them a single character), because the
      // field is required and staff type anything to clear it. Routing
      // around that data is the point, not fixing it here.
      // Times come from the SESSION, never from registration.date — that
      // column is a date-only marker pinned to midnight, so rendering it
      // as a time gave "12:00 AM" instead of the real 6:00 PM-11:00 PM.
      //
      // CORRECTION (2026-08-28): an earlier version of this comment, and
      // the commit that introduced it, also claimed the DAY was wrong.
      // It was not. Checked across all 273 website registrations on all
      // 9 nights: smsDate(registration.date) and smsDate(session.startAt)
      // agree every time. They must — the marker is midnight Manila of
      // night N and the session runs 6-11 PM on that same night N, so
      // both land on the same calendar day. Only a session starting after
      // midnight could separate them, and none does.
      //
      // The bad claim came from comparing a CONVERTED registration.date
      // against the session's own raw, unconverted `date` column. The
      // same naive-timestamp trap this file has now hit three times.
      // Only the TIME was ever wrong.
      //
      // Every WEBSITE registration has a session (268 of 268 in
      // production; sessionId is nullable only for walk-in weeknight
      // rows, which never reach this path). The null branch below is a
      // guard, not an expected case: it drops the time rather than
      // inventing one.
      const session = result.registration.sessionId
        ? await prisma.openPlayNightSession.findUnique({
            where: { id: result.registration.sessionId },
            select: { startAt: true, endAt: true },
          })
        : null;

      await smsDispatchService.dispatch({
        trigger: "OPEN_PLAY_REGISTRATION",
        entityId: result.registration.id,
        rawPhone: result.registration.phone,
        body: openPlayConfirmationBody({
          name: result.registration.playerName,
          date: session ? smsDate(session.startAt) : smsDate(result.registration.date),
          time: session ? smsTimeRange(session.startAt, session.endAt) : "",
        }),
      });
    }

    return { alreadyResolved: result.alreadyResolved, proof: result.proof };
  }

  // Same concurrency shape as rejectBookingPaymentProof. Two sequential
  // transactions, not one — resolving the proof, then releasing the
  // registration (which has its own session lock + seat-freeing +
  // waitlist-invite logic already, in releaseRegistration via
  // rejectRegistration). Accepted, documented risk: if the second
  // transaction fails after the first commits, the proof would show
  // REJECTED while the registration hasn't been released yet — a real
  // gap, but the same class of non-atomicity this codebase already
  // accepts for submitBookingPaymentProof's upload-then-transaction
  // shape, and there's no external I/O between these two steps (both hit
  // the same Postgres instance) to make that realistically likely.
  // Combining them into one transaction would mean reworking
  // releaseRegistration to accept an externally-supplied tx — out of
  // scope for this gate, not attempted here.
  async rejectOpenPlayRegistrationPaymentProof(
    proofId: string,
    reason: string,
    context: ResolveOpenPlayRegistrationPaymentProofContext,
  ): Promise<ResolveOpenPlayRegistrationPaymentProofResult> {
    if (!reason.trim()) {
      throw new Error("A rejection reason is required.");
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.openPlayRegistrationPaymentProof.updateMany({
        where: { id: proofId, status: "PENDING" },
        data: { status: "REJECTED", resolvedByEmployeeId: context.employeeId, resolvedAt: now, rejectionReason: reason },
      });

      const proof = await tx.openPlayRegistrationPaymentProof.findUniqueOrThrow({ where: { id: proofId } });

      if (updateResult.count === 0) {
        return { alreadyResolved: true as const, proof, registration: null };
      }

      const registration = await tx.openPlayNightRegistration.findUniqueOrThrow({ where: { id: proof.registrationId } });
      if (registration.status !== "PENDING_VERIFICATION") {
        throw new OpenPlayRegistrationNotAwaitingVerificationError();
      }

      return { alreadyResolved: false as const, proof, registration };
    });

    if (!result.alreadyResolved) {
      await this.writeAuditLog({
        actorUserId: context.actorUserId,
        action: "open_play_registration_payment_proof.rejected",
        entityType: "OpenPlayRegistrationPaymentProof",
        entityId: result.proof.id,
        newValues: result.proof,
      });

      // Frees the seat and (via releaseRegistration's own existing
      // no-walk-in-waitlist-head branch) invites the next online waiter —
      // that path already sends ITS OWN SMS (Gate 2's
      // inviteNextWaitlistEntry), so nothing extra needed here for them.
      await openPlayRegistrationService.rejectRegistration(result.registration.id, context.actorUserId);

      // No customer-facing status page exists for open-play (by design —
      // BUILD-SPEC.md §6 point 5: SMS is the channel, not a web lookup
      // page, same as this app's own booking flow has no customer-facing
      // rejection text either — confirmed, nothing to reuse). REJECTED is
      // terminal (rejectRegistration mirrors Booking's own "same as
      // CANCELLED" reasoning) — stated plainly: no resubmission for THIS
      // registration, only a brand new one.
      await sendOpenPlayProofSms(
        result.registration.phone,
        `Open Play payment could not be verified: ${smsTruncateReason(reason, 38)}. Your registration is cancelled. Please register again if you'd like to join.`,
      );
    }

    return { alreadyResolved: result.alreadyResolved, proof: result.proof };
  }

  async getProofById(proofId: string) {
    return prisma.openPlayRegistrationPaymentProof.findUnique({
      where: { id: proofId },
      include: { registration: true, resolvedByEmployee: true },
    });
  }

  async listPendingProofs() {
    return prisma.openPlayRegistrationPaymentProof.findMany({
      where: { status: "PENDING" },
      include: { registration: true },
      orderBy: { submittedAt: "asc" },
    });
  }

  // Same "lighter query for a badge on every page load" split as
  // bookingPaymentProofService.countPendingProofs.
  async countPendingProofs(): Promise<number> {
    return prisma.openPlayRegistrationPaymentProof.count({ where: { status: "PENDING" } });
  }

  private async writeAuditLog(entry: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    newValues?: unknown;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          newValues: JSON.parse(JSON.stringify(entry.newValues ?? null)),
        },
      });
    } catch (error) {
      logger.error({ err: error, action: entry.action }, "Failed to write audit log entry");
    }
  }
}

export const openPlayRegistrationPaymentProofService = new OpenPlayRegistrationPaymentProofService();
