import { randomUUID } from "node:crypto";

import { logger } from "@/lib/logger";
import type {
  ChargeInput,
  ChargeResult,
  PaymentService,
} from "@/services/payment/payment-service.interface";

// Sandbox implementation: always succeeds and never contacts a real
// processor. Swap PAYMENT_PROVIDER + payment-service.factory.ts to add a
// real provider (e.g. PayMongo) later without touching call sites.
export class LocalPaymentService implements PaymentService {
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const result: ChargeResult = {
      id: randomUUID(),
      status: "succeeded",
      provider: "local",
      amountCents: input.amountCents,
      currency: input.currency,
    };

    logger.info(
      { charge: result, referenceId: input.referenceId, description: input.description },
      "Sandbox payment charged",
    );

    return result;
  }
}
