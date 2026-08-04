import { getBookingPaymentState, type BookingPaymentInfo } from "./booking-list";

// Payment column (reported live): "has this been paid" / "when" / a
// filterable payment state for AWAITING_PAYMENT/PENDING_VERIFICATION/
// REJECTED/REFUNDED bookings that previously had no dedicated signal on
// the list at all. Proves the priority order — a real Sale always wins,
// even over a booking sitting in a payment-adjacent status.
function baseInfo(overrides: Partial<BookingPaymentInfo> = {}): BookingPaymentInfo {
  return {
    status: "CONFIRMED",
    sale: null,
    settledAt: null,
    holdExpiresAt: null,
    paymentProofs: [],
    ...overrides,
  };
}

const NOW = new Date("2026-08-01T12:00:00.000Z");

describe("getBookingPaymentState", () => {
  it("shows Paid, using settledAt over the sale's own createdAt when both exist", () => {
    const settledAt = new Date("2026-08-01T09:00:00.000Z");
    const saleCreatedAt = new Date("2026-08-01T09:05:00.000Z");
    const state = getBookingPaymentState(
      baseInfo({ status: "COMPLETED", sale: { createdAt: saleCreatedAt }, settledAt }),
      NOW,
    );
    expect(state.label).toBe("Paid");
    expect(state.variant).toBe("status");
    expect(state.when).toBe(settledAt);
  });

  it("falls back to the sale's own createdAt when settledAt is null", () => {
    const saleCreatedAt = new Date("2026-08-01T09:05:00.000Z");
    const state = getBookingPaymentState(
      baseInfo({ status: "COMPLETED", sale: { createdAt: saleCreatedAt }, settledAt: null }),
      NOW,
    );
    expect(state.when).toBe(saleCreatedAt);
  });

  it("a real Sale wins even if the booking's own status is still AWAITING_PAYMENT", () => {
    const saleCreatedAt = new Date("2026-08-01T09:05:00.000Z");
    const state = getBookingPaymentState(
      baseInfo({ status: "AWAITING_PAYMENT", sale: { createdAt: saleCreatedAt } }),
      NOW,
    );
    expect(state.label).toBe("Paid");
  });

  it("shows Awaiting verification with the proof's submission time, no sale yet", () => {
    const submittedAt = new Date("2026-08-01T11:00:00.000Z");
    const state = getBookingPaymentState(
      baseInfo({
        status: "PENDING_VERIFICATION",
        paymentProofs: [{ id: "proof-1", status: "PENDING", submittedAt, resolvedAt: null }],
      }),
      NOW,
    );
    expect(state.label).toBe("Awaiting verification");
    expect(state.variant).toBe("warning");
    expect(state.when).toBe(submittedAt);
  });

  it("shows Awaiting payment (not expired) for a live GCash hold", () => {
    const holdExpiresAt = new Date("2026-08-01T13:00:00.000Z"); // after NOW
    const state = getBookingPaymentState(
      baseInfo({ status: "AWAITING_PAYMENT", holdExpiresAt }),
      NOW,
    );
    expect(state.label).toBe("Awaiting payment");
    expect(state.variant).toBe("outline");
  });

  it("shows Hold expired once holdExpiresAt has passed", () => {
    const holdExpiresAt = new Date("2026-08-01T11:00:00.000Z"); // before NOW
    const state = getBookingPaymentState(
      baseInfo({ status: "AWAITING_PAYMENT", holdExpiresAt }),
      NOW,
    );
    expect(state.label).toBe("Hold expired");
    expect(state.variant).toBe("destructive");
  });

  it("shows Payment rejected with the proof's resolvedAt", () => {
    const resolvedAt = new Date("2026-08-01T10:00:00.000Z");
    const state = getBookingPaymentState(
      baseInfo({
        status: "REJECTED",
        paymentProofs: [
          {
            id: "proof-1",
            status: "REJECTED",
            submittedAt: new Date("2026-08-01T09:00:00.000Z"),
            resolvedAt,
          },
        ],
      }),
      NOW,
    );
    expect(state.label).toBe("Payment rejected");
    expect(state.variant).toBe("destructive");
    expect(state.when).toBe(resolvedAt);
  });

  it("shows Refunded using settledAt", () => {
    const settledAt = new Date("2026-08-01T08:00:00.000Z");
    const state = getBookingPaymentState(baseInfo({ status: "REFUNDED", settledAt }), NOW);
    expect(state.label).toBe("Refunded");
    expect(state.variant).toBe("destructive");
    expect(state.when).toBe(settledAt);
  });

  it("falls back to Unpaid — pay at venue for a plain live status with no sale", () => {
    const state = getBookingPaymentState(baseInfo({ status: "CONFIRMED" }), NOW);
    expect(state.label).toBe("Unpaid — pay at venue");
    expect(state.variant).toBe("outline");
    expect(state.when).toBeNull();
  });
});
