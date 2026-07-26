import { logger } from "@/lib/logger";
import type { SmsService } from "@/services/sms/sms-service.interface";

// Dev implementation: logs the message instead of sending it. Swap
// SMS_PROVIDER + sms-service.factory.ts to add a real provider (the
// named local provider, ~₱0.56/text, per BUILD-SPEC.md §6) later,
// without touching call sites — same swap point as
// services/email/console-email.service.ts. No account/API key is wired
// in this gate.
export class ConsoleSmsService implements SmsService {
  async send(phone: string, message: string): Promise<void> {
    logger.info({ phone, message }, "SMS (dev logger — not actually sent)");
  }
}
