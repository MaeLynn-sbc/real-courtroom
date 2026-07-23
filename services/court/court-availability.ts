import type { MaintenanceStatus } from "@/lib/generated/prisma/enums";

export type CourtAvailability = "AVAILABLE" | "UNDER_MAINTENANCE" | "DISABLED";

export interface MaintenanceWindow {
  startAt: Date;
  endAt: Date;
  status: MaintenanceStatus;
}

// Pure and dependency-free (no Prisma import) so it's unit-testable without
// a database connection. Only considers maintenance windows — booking
// overlap is added once the Booking module exists (see ARCHITECTURE.md's
// Phase 3 scope note).
export function isWithinMaintenanceWindow(now: Date, windows: MaintenanceWindow[]): boolean {
  return windows.some(
    (window) =>
      (window.status === "SCHEDULED" || window.status === "IN_PROGRESS") &&
      now >= window.startAt &&
      now < window.endAt,
  );
}
