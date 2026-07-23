import { logger } from "@/lib/logger";
import type { EmailService, SendEmailInput } from "@/services/email/email-service.interface";

// Dev implementation: logs the email instead of sending it. Swap
// EMAIL_PROVIDER + email-service.factory.ts to add a real provider later
// without touching call sites.
export class ConsoleEmailService implements EmailService {
  async send(input: SendEmailInput): Promise<void> {
    logger.info(
      { to: input.to, subject: input.subject, body: input.body },
      "Email (dev logger — not actually sent)",
    );
  }
}
