import type { PaymentMethod } from "@/lib/generated/prisma/client";

export interface SettlementPaymentMethodOption {
  id: string;
  key: "CASH" | "GCASH";
  label: string;
}

// The business only ever settles a booking/tab/walk-in with Cash or
// GCash — Bank Transfer, Card, and Pay at Venue (a booking-creation-time
// concept, never a real settlement — see PAY_AT_VENUE_PAYMENT_METHOD_KEY's
// own comment) are excluded here, once, rather than filtered ad hoc at
// each of the three call sites that render a settlement payment picker
// (settle-booking-form.tsx, tabs-panel.tsx, walk-in-registration-form.tsx).
// An allowlist, not a denylist: a stale/misconfigured PaymentMethod row
// added later can't leak into a settlement screen just by being active.
export function toSettlementPaymentMethodOptions(
  methods: Pick<PaymentMethod, "id" | "key" | "label">[],
): SettlementPaymentMethodOption[] {
  return methods
    .filter(
      (method): method is Pick<PaymentMethod, "id" | "key" | "label"> & { key: "CASH" | "GCASH" } =>
        method.key === "CASH" || method.key === "GCASH",
    )
    .map((method) => ({ id: method.id, key: method.key, label: method.label }));
}
