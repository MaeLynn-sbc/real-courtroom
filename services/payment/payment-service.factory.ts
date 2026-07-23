import { env } from "@/lib/env";
import { LocalPaymentService } from "@/services/payment/local-payment.service";
import type { PaymentService } from "@/services/payment/payment-service.interface";

let cachedService: PaymentService | undefined;

export function getPaymentService(): PaymentService {
  if (cachedService) {
    return cachedService;
  }

  switch (env.PAYMENT_PROVIDER) {
    case "local":
      cachedService = new LocalPaymentService();
      break;
    default:
      throw new Error(`Unsupported PAYMENT_PROVIDER: ${env.PAYMENT_PROVIDER}`);
  }

  return cachedService;
}
