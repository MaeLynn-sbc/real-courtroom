import type { EquipmentStatus } from "@/lib/generated/prisma/enums";

// Pure — no Prisma import, unit-tested directly. equipment.service.ts
// computes availableQuantity/hasUnresolvedDamageReport from live data and
// hands them here. Equipment is pooled inventory (no per-unit serials), so
// a single damaged/rented unit out of many doesn't blank out the whole
// type — DAMAGED/RENTED only apply once nothing is left available.
export type EquipmentCondition = "AVAILABLE" | "RENTED" | "DAMAGED" | "MAINTENANCE" | "RETIRED";

export interface EquipmentConditionInput {
  status: EquipmentStatus;
  availableQuantity: number;
  hasUnresolvedDamageReport: boolean;
}

export function calculateEquipmentCondition(input: EquipmentConditionInput): EquipmentCondition {
  if (input.status === "RETIRED") {
    return "RETIRED";
  }
  if (input.status === "MAINTENANCE") {
    return "MAINTENANCE";
  }
  if (input.availableQuantity <= 0 && input.hasUnresolvedDamageReport) {
    return "DAMAGED";
  }
  if (input.availableQuantity <= 0) {
    return "RENTED";
  }
  return "AVAILABLE";
}
