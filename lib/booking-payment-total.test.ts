import { coachingFeeCents, getExpectedPaymentTotalCents } from "@/lib/booking-payment-total";

// Four surfaces have to agree on the coaching fee: the public form's
// displayed total, the pre-filled "amount sent" field, this function, and
// approveBookingPaymentProof's check against it. If they disagree, a
// customer who paid the amount the form told them to gets REJECTED.
//
// They agree by construction because all four multiply in exactly one
// place — coachingFeeCents. These tests pin that.
describe("coaching fee is hourly", () => {
  it("multiplies the hourly rate by the hours purchased", () => {
    expect(coachingFeeCents({ rateCents: 50_000, hours: 1 })).toBe(50_000);
    expect(coachingFeeCents({ rateCents: 50_000, hours: 2 })).toBe(100_000);
    expect(coachingFeeCents({ rateCents: 50_000, hours: 3 })).toBe(150_000);
  });

  // The exact bug this change fixes: a coach on a 3-hour booking worked
  // 3 hours and was billed for 1.
  it("charges a 3-hour session three times a 1-hour session", () => {
    const oneHour = coachingFeeCents({ rateCents: 50_000, hours: 1 });
    const threeHours = coachingFeeCents({ rateCents: 50_000, hours: 3 });
    expect(threeHours).toBe(oneHour * 3);
  });
});

describe("getExpectedPaymentTotalCents", () => {
  it("adds court hire and the hourly coaching fee", () => {
    expect(
      getExpectedPaymentTotalCents({
        totalAmountCents: 120_000,
        coachSession: { status: "CONFIRMED", rateCents: 50_000, hours: 2 },
      }),
    ).toBe(220_000);
  });

  it("uses the SAME multiplication as coachingFeeCents", () => {
    const coachSession = { status: "CONFIRMED" as const, rateCents: 45_000, hours: 3 };
    const total = getExpectedPaymentTotalCents({ totalAmountCents: 90_000, coachSession });
    // If these ever diverge, a valid payment gets rejected on approval.
    expect(total).toBe(90_000 + coachingFeeCents(coachSession));
  });

  it("excludes a cancelled coach session regardless of hours", () => {
    expect(
      getExpectedPaymentTotalCents({
        totalAmountCents: 120_000,
        coachSession: { status: "CANCELLED", rateCents: 50_000, hours: 3 },
      }),
    ).toBe(120_000);
  });

  it("handles a booking with no coach", () => {
    expect(getExpectedPaymentTotalCents({ totalAmountCents: 120_000, coachSession: null })).toBe(
      120_000,
    );
  });

  it("treats a null court total as zero", () => {
    expect(
      getExpectedPaymentTotalCents({
        totalAmountCents: null,
        coachSession: { status: "CONFIRMED", rateCents: 50_000, hours: 2 },
      }),
    ).toBe(100_000);
  });

  // Historical rows are all hours = 1 (migration 78), so the pre-change
  // behaviour must be reproduced exactly for them — otherwise reports
  // over reconciled days would shift.
  it("reproduces the old flat behaviour at hours = 1", () => {
    expect(
      getExpectedPaymentTotalCents({
        totalAmountCents: 120_000,
        coachSession: { status: "CONFIRMED", rateCents: 50_000, hours: 1 },
      }),
    ).toBe(170_000);
  });
});
