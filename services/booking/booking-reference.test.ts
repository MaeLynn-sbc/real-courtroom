import { formatBookingReference } from "@/services/booking/booking-reference";

describe("formatBookingReference", () => {
  it("formats the date and zero-pads the sequence to 4 digits", () => {
    expect(formatBookingReference(new Date(2026, 6, 20), 1)).toBe("BK-20260720-0001");
  });

  it("pads single-digit months and days", () => {
    expect(formatBookingReference(new Date(2026, 0, 5), 1)).toBe("BK-20260105-0001");
  });

  it("does not truncate a sequence beyond 4 digits", () => {
    expect(formatBookingReference(new Date(2026, 6, 20), 12345)).toBe("BK-20260720-12345");
  });
});
