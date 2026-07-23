// Toggleable sale-producing modules — Booking and Equipment (paddle)
// rental are not on this list because they're permanently enabled. Each
// key maps to a Setting row (services/settings/settings.service.ts);
// absence of a row means the module is disabled (see getEnabledModules).
export const MODULE_KEYS = {
  MEMBERSHIP: "module.membership.enabled",
  LOCKER_RENTAL: "module.locker_rental.enabled",
  TOURNAMENT_REGISTRATION: "module.tournament_registration.enabled",
} as const;

export type ModuleKey = (typeof MODULE_KEYS)[keyof typeof MODULE_KEYS];

export type EnabledModules = Record<ModuleKey, boolean>;
