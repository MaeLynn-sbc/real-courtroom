import { env } from "@/lib/env";
import { ConsoleSmsService } from "@/services/sms/console-sms.service";
import type { SmsService } from "@/services/sms/sms-service.interface";

let cachedService: SmsService | undefined;

export function getSmsService(): SmsService {
  if (cachedService) {
    return cachedService;
  }

  // *** SWAP POINT (deploy) *** — same shape as upload-service.factory.ts
  // and email-service.factory.ts. When a real provider (Semaphore) is
  // ready: add it to SMS_PROVIDER's enum in lib/env.ts, add a
  // SemaphoreSmsService implementing SmsService, and a case here. No
  // application code outside this file changes.
  switch (env.SMS_PROVIDER) {
    case "console":
      cachedService = new ConsoleSmsService();
      break;
    default:
      throw new Error(`Unsupported SMS_PROVIDER: ${env.SMS_PROVIDER}`);
  }

  return cachedService;
}
