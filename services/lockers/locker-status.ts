import type { LockerStatus } from "@/lib/generated/prisma/enums";

// Pure — no Prisma import, unit-tested directly. Same "derive a display
// value, don't store it" pattern as services/court/court-availability.ts's
// getCurrentAvailability. "Reserved" needed no schema change — it's
// purely derived from an active rental's startAt being in the future.
export type LockerDisplayStatus = "AVAILABLE" | "OCCUPIED" | "RESERVED" | "MAINTENANCE" | "DISABLED";

export interface LockerRentalWindow {
  startAt: Date;
  endAt: Date;
}

export function calculateLockerDisplayStatus(
  status: LockerStatus,
  activeRentals: LockerRentalWindow[],
  now: Date = new Date(),
): LockerDisplayStatus {
  if (status === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (status === "DISABLED") {
    return "DISABLED";
  }

  const isOccupied = activeRentals.some((rental) => rental.startAt <= now && now < rental.endAt);
  if (isOccupied) {
    return "OCCUPIED";
  }

  const isReserved = activeRentals.some((rental) => rental.startAt > now);
  if (isReserved) {
    return "RESERVED";
  }

  return "AVAILABLE";
}
