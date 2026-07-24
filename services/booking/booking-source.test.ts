import { resolveBookingSource } from "@/services/booking/booking-source";

describe("resolveBookingSource", () => {
  it("resolves PUBLIC when the Sale source and bookedBy identity agree", () => {
    expect(resolveBookingSource("WEBSITE", true)).toBe("PUBLIC");
  });

  it("resolves STAFF when the Sale source and bookedBy identity agree", () => {
    expect(resolveBookingSource("RECEPTION", false)).toBe("STAFF");
  });

  it("resolves UNKNOWN when the two signals disagree (WEBSITE sale, non-website booker)", () => {
    expect(resolveBookingSource("WEBSITE", false)).toBe("UNKNOWN");
  });

  it("resolves UNKNOWN when the two signals disagree (RECEPTION sale, website booker)", () => {
    expect(resolveBookingSource("RECEPTION", true)).toBe("UNKNOWN");
  });

  it("resolves UNKNOWN when there is no linked Sale at all", () => {
    expect(resolveBookingSource(null, true)).toBe("UNKNOWN");
    expect(resolveBookingSource(null, false)).toBe("UNKNOWN");
  });

  it("resolves UNKNOWN for a Sale source that's never actually used for a booking (MOBILE_APP/ADMIN/TOURNAMENT)", () => {
    expect(resolveBookingSource("MOBILE_APP", true)).toBe("UNKNOWN");
    expect(resolveBookingSource("ADMIN", false)).toBe("UNKNOWN");
    expect(resolveBookingSource("TOURNAMENT", false)).toBe("UNKNOWN");
  });
});
