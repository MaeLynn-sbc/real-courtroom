import { bookingStatusTooEarlyReason } from "@/services/booking/booking-status";

// Owner, 2026-10-15: at 12:09 AM staff completed three bookings that started
// at 4, 6 and 8 PM the same day.
describe("bookingStatusTooEarlyReason", () => {
  const startAt = new Date("2026-10-15T08:00:00.000Z"); // 4:00 PM Manila

  it("refuses Completed and No-show before the booking starts", () => {
    const justAfterMidnight = new Date("2026-10-14T16:09:00.000Z"); // 12:09 AM Manila
    expect(bookingStatusTooEarlyReason("COMPLETED", startAt, justAfterMidnight)).toMatch(/hasn't started yet/);
    expect(bookingStatusTooEarlyReason("NO_SHOW", startAt, justAfterMidnight)).toMatch(/hasn't started yet/);
    expect(bookingStatusTooEarlyReason("COMPLETED", startAt, new Date(startAt.getTime() - 60_000))).not.toBeNull();
  });

  it("allows Completed and No-show from the start time on", () => {
    expect(bookingStatusTooEarlyReason("COMPLETED", startAt, startAt)).toBeNull();
    expect(bookingStatusTooEarlyReason("NO_SHOW", startAt, new Date(startAt.getTime() + 20 * 60_000))).toBeNull();
  });

  it("opens check-in one hour before the start, not earlier", () => {
    expect(bookingStatusTooEarlyReason("CHECKED_IN", startAt, new Date(startAt.getTime() - 61 * 60_000))).toMatch(
      /Too early to check in/,
    );
    expect(bookingStatusTooEarlyReason("CHECKED_IN", startAt, new Date(startAt.getTime() - 60 * 60_000))).toBeNull();
  });

  it("names the start time in Manila time", () => {
    const reason = bookingStatusTooEarlyReason("COMPLETED", startAt, new Date("2026-10-15T00:00:00.000Z"));
    expect(reason).toMatch(/4:00/);
  });

  it("leaves other transitions alone", () => {
    expect(bookingStatusTooEarlyReason("CANCELLED", startAt, new Date(0))).toBeNull();
  });
});
