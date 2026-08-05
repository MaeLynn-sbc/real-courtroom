import { env } from "@/lib/env";
import { ConsoleSmsService } from "@/services/sms/console-sms.service";
import { SemaphoreSmsService } from "@/services/sms/semaphore-sms.service";
import type { SmsService } from "@/services/sms/sms-service.interface";

let cachedService: SmsService | undefined;

export function getSmsService(): SmsService {
  if (cachedService) {
    return cachedService;
  }

  // *** SWAP POINT (deploy) *** — same shape as upload-service.factory.ts
  // and email-service.factory.ts. No application code outside this file
  // needs to change to add a future provider.
  switch (env.SMS_PROVIDER) {
    case "console":
      cachedService = new ConsoleSmsService();
      break;
    case "semaphore":
      cachedService = new SemaphoreSmsService();
      break;
    default:
      throw new Error(`Unsupported SMS_PROVIDER: ${env.SMS_PROVIDER}`);
  }

  return cachedService;
}
