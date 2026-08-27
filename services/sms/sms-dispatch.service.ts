import { getBusinessDateRange } from "@/lib/business-date";
import { computeBusinessDate } from "@/lib/business-date";
import type { Prisma, SmsStatus, SmsTrigger } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { normalizePhilippineMobile } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { analyzeSmsBody } from "@/lib/sms-encoding";
import { settingsService } from "@/services/settings/settings.service";
import { getSmsService } from "@/services/sms/sms-service.factory";
import { SmsSendError, type SmsSendResult } from "@/services/sms/sms-service.interface";

// The single chokepoint every outbound SMS passes through. No caller ever
// touches getSmsService() directly — going through here is what makes the
// normalizer, the kill switch, the daily cap, the encoding check and the
// audit trail unskippable rather than five things each call site has to
// remember.
//
// ORDER MATTERS, and it is: dedupe claim -> kill switch -> cap ->
// normalise -> encode -> send -> record. Everything that can decline the
// send happens BEFORE the provider is called, so a declined message costs
// nothing. The dedupe claim is first because it is the only guard that
// must hold against a CONCURRENT duplicate, not just a sequential one.
//
// Owner cap decision (2026-08-28): 200 per business day. Counted against
// the same rollover-hour window the rest of the app uses, so "today" means
// the same thing here as it does in reconciliation and payroll.
const DAILY_SEND_CAP = 200;

export interface DispatchSmsInput {
  trigger: SmsTrigger;
  /** The row this message is about — booking, registration or session id. */
  entityId: string;
  /** Whatever is stored on the entity, unnormalised. */
  rawPhone: string | null | undefined;
  /** The FINAL body, already substituted. Never a template. */
  body: string;
}

export type DispatchOutcome = SmsStatus | "DUPLICATE";

// NEVER THROWS. Every caller is a post-commit side effect on a booking, a
// registration or a coaching session — a text failing to send must not
// roll back money that has already changed hands. The existing three send
// paths each wrap getSmsService() in their own try/catch for this reason;
// centralising it here means a new caller cannot forget to.
export class SmsDispatchService {
  async dispatch(input: DispatchSmsInput): Promise<DispatchOutcome> {
    try {
      return await this.run(input);
    } catch (error) {
      logger.error(
        { error, trigger: input.trigger, entityId: input.entityId },
        "SMS dispatch failed outside the send path",
      );
      return "FAILED";
    }
  }

  private async run(input: DispatchSmsInput): Promise<DispatchOutcome> {
    const dedupeKey = `${input.trigger}:${input.entityId}`;
    const analysis = analyzeSmsBody(input.body);
    const phone = normalizePhilippineMobile(input.rawPhone);

    const base = {
      trigger: input.trigger,
      entityId: input.entityId,
      body: input.body,
      rawPhone: input.rawPhone ?? null,
      phone,
      encoding: analysis.encoding,
      segments: analysis.segments,
    };

    // ---- 1. SYSTEM-STATE refusals, BEFORE the key is claimed ---------
    // Order matters enormously here. These two say nothing about this
    // entity — they say the feature is off, or the venue has already sent
    // its budget today. If they claimed the dedupeKey, every booking made
    // while the kill switch was off would be permanently un-textable the
    // moment the switch went back on, and one runaway day would poison
    // every entity it touched forever. So they record with a NULL key
    // (see SmsLog.dedupeKey) and block nothing.
    if (!(await settingsService.getSmsEnabled())) {
      return this.recordUnclaimed(base, "SKIPPED_DISABLED");
    }

    if (await this.dailyCapReached()) {
      logger.error({ dedupeKey, cap: DAILY_SEND_CAP }, "SMS skipped: daily cap reached");
      return this.recordUnclaimed(base, "SKIPPED_CAP");
    }

    // ---- 2. Claim the key BEFORE anything is spent -------------------
    // The unique index does the work. A concurrent duplicate loses this
    // insert and returns without sending, which a read-then-write check
    // could not guarantee.
    const claimed = await this.claim({ ...base, dedupeKey });
    if (!claimed) {
      logger.info({ dedupeKey }, "SMS already handled for this entity — not sending again");
      return "DUPLICATE";
    }

    // ---- 3. A decision about THIS entity — keeps the key -------------
    if (!phone) {
      // The expected outcome for a customer typo. Recorded, not swallowed
      // — rawPhone is on the row as the evidence.
      logger.warn(
        { dedupeKey, rawPhone: input.rawPhone },
        "SMS skipped: stored phone is not a valid PH mobile",
      );
      return this.settle(dedupeKey, "SKIPPED_INVALID");
    }

    // Logged BEFORE the send, at warn, because a two-segment message is a
    // doubled bill and must be visible as it happens rather than only in
    // a month-end total. Not a blocker: a real name with an acute accent
    // is a legitimate reason to pay for two segments.
    if (analysis.segments > 1) {
      logger.warn(
        {
          dedupeKey,
          encoding: analysis.encoding,
          segments: analysis.segments,
          length: analysis.length,
          offendingCharacters: analysis.offendingCharacters,
        },
        "SMS will bill as multiple segments",
      );
    }

    // Stamped before the request leaves so an ambiguous row can be matched
    // against the provider's own log by recipient and minute.
    const requestedAt = new Date();
    await prisma.smsLog.update({ where: { dedupeKey }, data: { requestedAt } });

    try {
      const result = await getSmsService().send(phone, input.body);
      return this.settle(dedupeKey, "SENT", { result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const sendError = error instanceof SmsSendError ? error : null;

      // THE KEY DECISION. Release the dedupeKey only when the provider
      // demonstrably never accepted the message — 401/403/429. Every
      // ambiguous kind (5xx, timeout, reset) KEEPS the key, because a lost
      // response is the likeliest way to have sent a message we believe
      // failed, and a duplicate text is worse than a missing one. An
      // unclassified error is treated as ambiguous by default.
      const releaseKey = sendError?.provablyNotSent ?? false;

      logger.error(
        {
          error,
          dedupeKey,
          failureKind: sendError?.kind ?? "UNKNOWN",
          httpStatus: sendError?.httpStatus ?? null,
          releaseKey,
        },
        releaseKey
          ? "SMS send refused by the provider — key released, this entity can be retried"
          : "SMS send failed ambiguously — key kept, needs checking against the provider log",
      );

      return this.settle(dedupeKey, "FAILED", {
        error: message,
        failureKind: sendError?.kind ?? "NETWORK",
        httpStatus: sendError?.httpStatus ?? null,
        releaseKey,
      });
    }
  }

  // Records an attempt WITHOUT taking the dedupeKey, so the entity stays
  // textable once the system state that refused it changes.
  private async recordUnclaimed(
    base: Omit<Prisma.SmsLogCreateInput, "status" | "dedupeKey">,
    status: SmsStatus,
  ): Promise<SmsStatus> {
    await prisma.smsLog.create({ data: { ...base, status, dedupeKey: null } });
    return status;
  }

  // Returns false when the key is already taken — i.e. this entity has
  // already been handled, whether it sent, failed or was skipped.
  private async claim(data: {
    dedupeKey: string;
    trigger: SmsTrigger;
    entityId: string;
    body: string;
    rawPhone: string | null;
    phone: string | null;
    encoding: string;
    segments: number;
  }): Promise<boolean> {
    try {
      await prisma.smsLog.create({ data: { ...data, status: "QUEUED" } });
      return true;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  private async settle(
    dedupeKey: string,
    status: SmsStatus,
    outcome: {
      result?: SmsSendResult;
      error?: string;
      failureKind?: string | null;
      httpStatus?: number | null;
      // Nulls the dedupeKey, so this entity becomes textable again. Only
      // ever true for a provably-not-sent refusal.
      releaseKey?: boolean;
    } = {},
  ): Promise<SmsStatus> {
    await prisma.smsLog.update({
      where: { dedupeKey },
      data: {
        status,
        error: outcome.error ?? null,
        failureKind: outcome.failureKind ?? null,
        httpStatus: outcome.httpStatus ?? null,
        providerMessageId: outcome.result?.providerMessageId ?? null,
        providerStatus: outcome.result?.providerStatus ?? null,
        ...(outcome.releaseKey ? { dedupeKey: null } : {}),
      },
    });
    return status;
  }

  // Counts SENT only. A skipped or failed message spent no credit, so it
  // must not consume the budget that protects against a runaway trigger.
  private async dailyCapReached(): Promise<boolean> {
    const { businessDateRolloverHour } = await settingsService.getCourtHours();
    const now = new Date();
    const today = computeBusinessDate(now, businessDateRolloverHour);
    const { start, end } = getBusinessDateRange(today, businessDateRolloverHour);

    const sentToday = await prisma.smsLog.count({
      where: { status: "SENT", createdAt: { gte: start, lt: end } },
    });

    return sentToday >= DAILY_SEND_CAP;
  }
}

// Duck-typed, matching this codebase's existing convention (booking.service.ts,
// open-play-checkin.service.ts, attendance-record.service.ts) — avoids
// importing the generated error class to read one field.
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export const smsDispatchService = new SmsDispatchService();
