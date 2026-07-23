import { isWithinMaintenanceWindow } from "@/services/court/court-availability";

describe("isWithinMaintenanceWindow", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("returns false when there are no windows", () => {
    expect(isWithinMaintenanceWindow(now, [])).toBe(false);
  });

  it("returns true when now falls inside a SCHEDULED window", () => {
    expect(
      isWithinMaintenanceWindow(now, [
        {
          startAt: new Date("2026-07-20T11:00:00Z"),
          endAt: new Date("2026-07-20T13:00:00Z"),
          status: "SCHEDULED",
        },
      ]),
    ).toBe(true);
  });

  it("returns true when now falls inside an IN_PROGRESS window", () => {
    expect(
      isWithinMaintenanceWindow(now, [
        {
          startAt: new Date("2026-07-20T11:00:00Z"),
          endAt: new Date("2026-07-20T13:00:00Z"),
          status: "IN_PROGRESS",
        },
      ]),
    ).toBe(true);
  });

  it("ignores COMPLETED and CANCELLED windows even if now falls inside them", () => {
    expect(
      isWithinMaintenanceWindow(now, [
        {
          startAt: new Date("2026-07-20T11:00:00Z"),
          endAt: new Date("2026-07-20T13:00:00Z"),
          status: "COMPLETED",
        },
        {
          startAt: new Date("2026-07-20T11:00:00Z"),
          endAt: new Date("2026-07-20T13:00:00Z"),
          status: "CANCELLED",
        },
      ]),
    ).toBe(false);
  });

  it("returns false when now is outside the window (before start or after end)", () => {
    const windows = [
      {
        startAt: new Date("2026-07-20T13:00:00Z"),
        endAt: new Date("2026-07-20T14:00:00Z"),
        status: "SCHEDULED" as const,
      },
    ];

    expect(isWithinMaintenanceWindow(now, windows)).toBe(false);
  });

  it("treats the window as inclusive of start and exclusive of end", () => {
    const windowStart = new Date("2026-07-20T12:00:00Z");
    const windowEnd = new Date("2026-07-20T13:00:00Z");
    const window = { startAt: windowStart, endAt: windowEnd, status: "SCHEDULED" as const };

    expect(isWithinMaintenanceWindow(windowStart, [window])).toBe(true);
    expect(isWithinMaintenanceWindow(windowEnd, [window])).toBe(false);
  });
});
