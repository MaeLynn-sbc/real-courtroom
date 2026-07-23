import { env } from "@/lib/env";

const FEATURE_FLAGS = {
  payments: env.FEATURE_PAYMENTS,
  openPlay: env.FEATURE_OPEN_PLAY,
  tournaments: env.FEATURE_TOURNAMENTS,
  memberships: env.FEATURE_MEMBERSHIPS,
  equipmentRentals: env.FEATURE_EQUIPMENT_RENTALS,
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFeatureEnabled(flag: FeatureFlag): boolean {
  return FEATURE_FLAGS[flag] === "true";
}
