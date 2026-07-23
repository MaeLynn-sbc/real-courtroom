import { canTransitionBookingStatus } from "@/services/booking/booking-status";

describe("canTransitionBookingStatus", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransitionBookingStatus("PENDING", "CONFIRMED")).toBe(true);
    expect(canTransitionBookingStatus("CONFIRMED", "CHECKED_IN")).toBe(true);
    expect(canTransitionBookingStatus("CHECKED_IN", "COMPLETED")).toBe(true);
  });

  it("allows cancellation from any non-terminal status", () => {
    expect(canTransitionBookingStatus("PENDING", "CANCELLED")).toBe(true);
    expect(canTransitionBookingStatus("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransitionBookingStatus("CHECKED_IN", "CANCELLED")).toBe(true);
  });

  it("allows marking a confirmed booking as a no-show", () => {
    expect(canTransitionBookingStatus("CONFIRMED", "NO_SHOW")).toBe(true);
  });

  it("rejects transitions out of terminal statuses", () => {
    expect(canTransitionBookingStatus("COMPLETED", "CONFIRMED")).toBe(false);
    expect(canTransitionBookingStatus("CANCELLED", "CONFIRMED")).toBe(false);
    expect(canTransitionBookingStatus("NO_SHOW", "CONFIRMED")).toBe(false);
  });

  it("rejects skipping states (e.g. pending straight to checked-in)", () => {
    expect(canTransitionBookingStatus("PENDING", "CHECKED_IN")).toBe(false);
    expect(canTransitionBookingStatus("PENDING", "COMPLETED")).toBe(false);
  });

  it("rejects transitioning into PAID (payments are out of scope)", () => {
    expect(canTransitionBookingStatus("PENDING", "PAID")).toBe(false);
    expect(canTransitionBookingStatus("CONFIRMED", "PAID")).toBe(false);
  });

  it("rejects a no-op transition to the same status", () => {
    expect(canTransitionBookingStatus("CONFIRMED", "CONFIRMED")).toBe(false);
  });
});
