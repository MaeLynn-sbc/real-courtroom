import { prisma } from "@/lib/prisma";
import { dailyScope, nextSequence } from "@/lib/reference-counter";
import { PAY_AT_VENUE_PAYMENT_METHOD_KEY, WEBSITE_SYSTEM_USER_EMAIL } from "@/lib/system-identities";
import { formatShiftNumber } from "@/services/shift/shift-number";

export interface WebsiteBookingContext {
  userId: string;
  employeeId: string;
  shiftId: string;
  paymentMethodId: string;
}

// Resolves the seeded "Website" system identity every public booking is
// attributed to (see prisma/seed.ts and ARCHITECTURE.md's PHASE 12
// addendum) — self-heals the perpetual Shift if it was ever manually
// closed, so the public booking flow never hard-depends on nobody
// touching that row. The User/Employee themselves are expected to
// always exist (seeded); a missing row here means the seed hasn't been
// run, which is a genuine setup error worth surfacing, not silently
// recovering from.
export async function getWebsiteBookingContext(): Promise<WebsiteBookingContext> {
  const [user, paymentMethod] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: WEBSITE_SYSTEM_USER_EMAIL },
      include: { employee: true },
    }),
    prisma.paymentMethod.findUniqueOrThrow({ where: { key: PAY_AT_VENUE_PAYMENT_METHOD_KEY } }),
  ]);

  if (!user.employee) {
    throw new Error("Website system employee is missing — re-run the database seed.");
  }

  let shift = await prisma.shift.findFirst({
    where: { employeeId: user.employee.id, status: "OPEN" },
  });

  if (!shift) {
    const now = new Date();
    const sequence = await nextSequence(dailyScope("SHIFT", now));
    shift = await prisma.shift.create({
      data: {
        shiftNumber: formatShiftNumber(now, sequence),
        employeeId: user.employee.id,
        openingNotes: "Perpetual shift for public-website bookings — not a real cash drawer.",
      },
    });
  }

  return {
    userId: user.id,
    employeeId: user.employee.id,
    shiftId: shift.id,
    paymentMethodId: paymentMethod.id,
  };
}
