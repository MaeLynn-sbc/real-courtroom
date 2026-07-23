import type { Metadata } from "next";

import { PaymentMethodsWorkspace } from "@/features/payment-methods/components/payment-methods-workspace";
import { saleService } from "@/services/sales/sale.service";

export const metadata: Metadata = {
  title: "Payment Methods",
};

// No searchParams/dynamic segment/auth() call on this page to signal Next
// that it needs live rendering — without this, it gets statically
// prerendered at build time and would never reflect a newly added payment
// method in production. See ARCHITECTURE.md's v1.1 addenda.
export const dynamic = "force-dynamic";

export default async function PaymentMethodsPage() {
  const paymentMethods = await saleService.listPaymentMethods(true);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment methods</h1>
        <p className="text-muted-foreground text-sm">
          How reception collects payment for bookings, memberships, and rentals.
        </p>
      </div>

      <PaymentMethodsWorkspace paymentMethods={paymentMethods} />
    </div>
  );
}
