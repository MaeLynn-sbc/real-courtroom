import type { BillingPeriod } from "@/lib/generated/prisma/enums";

// Pure — no Prisma import, unit-tested directly. Renews from
// max(currentEndDate, now): a membership renewed before it expires
// extends from its current end date (no time is lost); one renewed after
// expiring starts the new period from today (no back-dating).
export function calculateRenewalEndDate(
  currentEndDate: Date,
  billingPeriod: BillingPeriod,
  now: Date = new Date(),
): Date {
  const base = currentEndDate > now ? currentEndDate : now;
  const next = new Date(base);

  switch (billingPeriod) {
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      break;
    case "ANNUAL":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }

  return next;
}
