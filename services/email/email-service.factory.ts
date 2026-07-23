import { ConsoleEmailService } from "@/services/email/console-email.service";
import type { EmailService } from "@/services/email/email-service.interface";
import { env } from "@/lib/env";

let cachedService: EmailService | undefined;

export function getEmailService(): EmailService {
  if (cachedService) {
    return cachedService;
  }

  switch (env.EMAIL_PROVIDER) {
    case "console":
      cachedService = new ConsoleEmailService();
      break;
    default:
      throw new Error(`Unsupported EMAIL_PROVIDER: ${env.EMAIL_PROVIDER}`);
  }

  return cachedService;
}
