import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { settingsService } from "@/services/settings/settings.service";
import type { SmsService } from "@/services/sms/sms-service.interface";

const SEMAPHORE_ENDPOINT = "https://api.semaphore.co/api/v4/messages";

// Semaphore API v4 (form-encoded POST) response shape — one object per
// recipient, even for a single-number send.
interface SemaphoreMessageResult {
  message_id: number;
  status: string;
  recipient: string;
}

// Real send path (BUILD-SPEC.md §6 names Semaphore). sendername is
// deliberately omitted whenever the CMS setting is empty — Semaphore
// falls back to the account's own registered sender name in that case
// (its API docs), so an unapproved/rejected custom sender name is never a
// blocker to sending, only cosmetic (features/cms/schemas/cms.schema.ts's
// smsSenderName: "Never required to have real SMS sending working").
export class SemaphoreSmsService implements SmsService {
  async send(phone: string, message: string): Promise<void> {
    const { smsSenderName } = await settingsService.getBookingCommunicationSettings();

    const body = new URLSearchParams({
      apikey: env.SEMAPHORE_API_KEY!,
      number: phone,
      message,
    });
    if (smsSenderName) {
      body.set("sendername", smsSenderName);
    }

    const response = await fetch(SEMAPHORE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Semaphore SMS request failed (${response.status}): ${text}`);
    }

    const results = (await response.json()) as SemaphoreMessageResult[];
    // "Refunded" is Semaphore's own signal that delivery failed and the
    // credit was returned — treated as a failure here for the same reason
    // "Failed" is: every caller of getSmsService().send() already wraps
    // this in a best-effort try/catch (logged, never thrown into a
    // booking/registration transaction) — see e.g.
    // booking-payment-proof.service.ts's sendBookingProofSms — so
    // throwing here surfaces the real outcome to that existing log line
    // instead of silently reporting success for a message that never
    // arrived.
    const failed = results.find((result) => result.status === "Failed" || result.status === "Refunded");
    if (failed) {
      throw new Error(`Semaphore SMS was not delivered — status: ${failed.status}`);
    }

    logger.info({ phone, status: results[0]?.status }, "SMS sent via Semaphore");
  }
}
