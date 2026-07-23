import { formatAuditLogLabel, formatEntityTypeLabel } from "@/services/notifications/notification-reference";

describe("formatAuditLogLabel", () => {
  it("turns a dotted, underscored action into a capitalized sentence", () => {
    expect(formatAuditLogLabel("equipment_rental.created")).toBe("Equipment rental created");
  });

  it("handles a single-word entity prefix", () => {
    expect(formatAuditLogLabel("booking.created")).toBe("Booking created");
  });

  it("handles multiple underscored verb words", () => {
    expect(formatAuditLogLabel("court.maintenance_status_changed")).toBe(
      "Court maintenance status changed",
    );
  });

  it("handles an underscored entity prefix", () => {
    expect(formatAuditLogLabel("open_play.match_started")).toBe("Open play match started");
  });
});

describe("formatEntityTypeLabel", () => {
  it("inserts a space before each capital in a PascalCase model name", () => {
    expect(formatEntityTypeLabel("EquipmentRental")).toBe("Equipment Rental");
  });

  it("handles a single-word model name unchanged", () => {
    expect(formatEntityTypeLabel("Booking")).toBe("Booking");
  });

  it("handles a three-word PascalCase model name", () => {
    expect(formatEntityTypeLabel("OpenPlaySession")).toBe("Open Play Session");
  });
});
