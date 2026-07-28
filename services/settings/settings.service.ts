import { randomUUID } from "node:crypto";

import type {
  BusinessInfo,
  CourtHoursSettings,
  GalleryImage,
  HomepageHero,
  OpenPlaySettings,
  OtherRateLine,
} from "@/features/cms/schemas/cms.schema";
import type { UpsertSettingInput } from "@/features/settings/schemas/settings.schema";
import { CMS_KEYS } from "@/lib/cms-keys";
import { logger } from "@/lib/logger";
import { MODULE_KEYS, type EnabledModules, type ModuleKey } from "@/lib/module-flags";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  PUBLIC_VISIBILITY_KEYS,
  type PublicVisibilityFlags,
  type PublicVisibilityKey,
} from "@/lib/public-visibility";

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// Phase 8 Gate 2 — see getBookingRequirePrepayment/setBookingRequirePrepayment.
const BOOKING_REQUIRE_PREPAYMENT_KEY = "booking.requirePrepayment";

// Phase 10 Gate 1 — see getOrCreateDisplaySlug. An unguessable path
// component (not a permission check) standing in for "the TV display's
// URL isn't listed anywhere a random visitor would find it" — the route
// itself is intentionally login-free per BUILD-SPEC.md §12/§13.
const DISPLAY_SLUG_KEY = "display.slug";

// Open-play online self-registration, Gate 1 — see
// getOpenPlayOnlineRegistrationEnabled/setOpenPlayOnlineRegistrationEnabled.
// Named differently from BOOKING_REQUIRE_PREPAYMENT_KEY on purpose:
// Booking's switch toggles a payment METHOD on an already-existing
// public flow (prepay vs. pay-at-venue) — this switch gates whether the
// public registration flow exists at all. There is no "online
// registration without prepayment" mode to toggle between; prepayment
// is inherent to the flow itself whenever a slot is open (BUILD-SPEC.md
// §6). Off means the feature isn't reachable; on means it is. Same
// single-point-of-control, required-OFF-by-default shape either way.
const OPEN_PLAY_ONLINE_REGISTRATION_ENABLED_KEY = "openPlay.onlineRegistrationEnabled";

function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002"
  );
}

const DEFAULT_HERO: HomepageHero = {
  title: "THE COURTROOM",
  subtitle: "Indoor pickleball courts, open play, and more.",
  ctaText: "Book Now",
  imageUrl: null,
};

const DEFAULT_BUSINESS_INFO: BusinessInfo = {
  name: "The Courtroom",
  phone: "",
  email: "",
  address: "",
  hours: "",
  facebookUrl: "",
  mapsUrl: "",
};

// BUILD-SPEC.md §0's confirmed business facts — facility open 7AM, close
// 11PM every day; Court 1 until 6PM, Court 2 until 8PM, Court 3 has no
// per-court cutoff of its own (runs until facility close); everyone until
// 6PM on Fri/Sat; business day rolls over at 3AM. A facility with no
// admin edits yet behaves exactly as documented.
const DEFAULT_COURT_HOURS: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  facilityCloseTimes: {
    "0": "23:00",
    "1": "23:00",
    "2": "23:00",
    "3": "23:00",
    "4": "23:00",
    "5": "23:00",
    "6": "23:00",
  },
  fridaySaturdayCloseTime: "18:00",
  courtCloseTimes: {
    "Court 1": "18:00",
    "Court 2": "20:00",
    "Court 3": "00:00",
  },
  businessDateRolloverHour: 3,
};

// BUILD-SPEC.md §6/§7 defaults.
const DEFAULT_OPEN_PLAY_SETTINGS: OpenPlaySettings = {
  noShowReleaseMinutes: 30,
  maxWaitMinutes: 20,
  skillWindow: 1,
  autoConfirmProposals: false,
  targetGameMinutes: 15,
  weeknightGameRateCents: 3500,
  // Open-play online self-registration, Gate 2 review follow-up: 4 days
  // (owner-editable) — midway through the user's own proposed 3-5 day
  // range, giving a Friday night a Monday open and a Saturday night a
  // Tuesday open by default.
  onlineRegistrationLeadTimeDays: 4,
  // BUILD-SPEC.md §9 "Fri/Sat ₱150 registrations" — the actual, real
  // amount collected at the desk since Phase 7, only now recorded.
  friSatRegistrationFeeCents: 15000,
};

// A generic key -> value(Json) table (existing since Phase 2, never
// written to by any service until now) rather than typed columns per
// setting — this workspace is intentionally a small, generic editor; it
// doesn't invent specific settings nobody asked for yet.
export class SettingsService {
  async listSettings() {
    return prisma.setting.findMany({ orderBy: { key: "asc" } });
  }

  async upsertSetting(input: UpsertSettingInput, actorUserId: string) {
    const setting = await prisma.setting.upsert({
      where: { key: input.key },
      update: { value: input.value, description: input.description, updatedById: actorUserId },
      create: {
        key: input.key,
        value: input.value,
        description: input.description,
        updatedById: actorUserId,
      },
    });

    await this.writeSettingAuditLog("setting.updated", setting.id, setting.key, setting.value, actorUserId);

    return setting;
  }

  async deleteSetting(key: string, actorUserId: string) {
    const setting = await prisma.setting.delete({ where: { key } });

    try {
      await prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action: "setting.deleted",
          entityType: "Setting",
          entityId: setting.id,
          oldValues: { key: setting.key },
        },
      });
    } catch (error) {
      logger.error({ err: error, action: "setting.deleted", userId: actorUserId }, "Failed to write audit log entry");
    }
  }

  // --- Boolean flag groups (module toggles, public visibility) -----------
  // Same shape for both: fixed known keys, real JSON booleans, absence of
  // a row means false — distinct from the free-text generic editor above.

  async getEnabledModules(): Promise<EnabledModules> {
    return this.getBooleanFlags(Object.values(MODULE_KEYS)) as Promise<EnabledModules>;
  }

  async setModuleEnabled(key: ModuleKey, enabled: boolean, actorUserId: string) {
    return this.setBooleanFlag(key, enabled, actorUserId);
  }

  async getPublicVisibility(): Promise<PublicVisibilityFlags> {
    return this.getBooleanFlags(Object.values(PUBLIC_VISIBILITY_KEYS)) as Promise<PublicVisibilityFlags>;
  }

  async setPublicVisibility(key: PublicVisibilityKey, visible: boolean, actorUserId: string) {
    return this.setBooleanFlag(key, visible, actorUserId);
  }

  // Phase 8 Gate 2 (BUILD-SPEC.md §8): the ONE switch that decides
  // whether the public booking path requires GCash prepayment. Every
  // other piece of Phase 8 code reads THIS, never a second copy of the
  // decision — actions/public-booking.actions.ts is the only call site.
  //
  // Owner's final, informed decision at deploy time: court bookings ship
  // requiring prepayment, same as open play's own switch below — not
  // the original built-OFF default. getBooleanFlags' own "no row ->
  // false" is shared by every boolean flag in this service (module
  // toggles, public visibility, ...); flipping that shared default
  // would silently turn ON every other flag too, so — same fix as
  // getOpenPlayOnlineRegistrationEnabled just below — this method
  // deliberately does NOT go through it. Direct query instead: no row
  // at all (a genuinely fresh database, or this key never explicitly
  // touched) -> true; a row that exists reflects a real, later decision
  // (an owner explicitly toggling it via setBookingRequirePrepayment)
  // and always wins.
  async getBookingRequirePrepayment(): Promise<boolean> {
    const row = await prisma.setting.findUnique({ where: { key: BOOKING_REQUIRE_PREPAYMENT_KEY } });
    if (!row) {
      return true;
    }
    return row.value === true;
  }

  async setBookingRequirePrepayment(value: boolean, actorUserId: string) {
    return this.setBooleanFlag(BOOKING_REQUIRE_PREPAYMENT_KEY, value, actorUserId);
  }

  // Open-play online self-registration. Originally built required-OFF
  // (BUILD-SPEC.md §6 "PARKED" subsection) using the same shared
  // getBooleanFlags helper every other flag here uses (missing row ->
  // false). Owner's final, informed decision at deploy time: this ships
  // ON by default, not off. getBooleanFlags' own "no row -> false" is
  // shared by every boolean flag in this service (booking prepayment,
  // feature modules, public visibility, ...) — flipping that default
  // would silently turn ON every other flag too, so this method
  // deliberately does NOT go through it. Direct query instead: no row
  // at all (a genuinely fresh database, or this key never explicitly
  // touched) -> true; a row that exists reflects a real, later decision
  // (an owner explicitly toggling it, e.g. via
  // setOpenPlayOnlineRegistrationEnabled below) and always wins.
  async getOpenPlayOnlineRegistrationEnabled(): Promise<boolean> {
    const row = await prisma.setting.findUnique({ where: { key: OPEN_PLAY_ONLINE_REGISTRATION_ENABLED_KEY } });
    if (!row) {
      return true;
    }
    return row.value === true;
  }

  async setOpenPlayOnlineRegistrationEnabled(value: boolean, actorUserId: string) {
    return this.setBooleanFlag(OPEN_PLAY_ONLINE_REGISTRATION_ENABLED_KEY, value, actorUserId);
  }

  private async getBooleanFlags(keys: readonly string[]): Promise<Record<string, boolean>> {
    const rows = await prisma.setting.findMany({ where: { key: { in: keys as string[] } } });
    const byKey = new Map(rows.map((row) => [row.key, row.value === true]));
    return Object.fromEntries(keys.map((key) => [key, byKey.get(key) ?? false]));
  }

  private async setBooleanFlag(key: string, value: boolean, actorUserId: string) {
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value, updatedById: actorUserId },
      create: { key, value, updatedById: actorUserId },
    });

    await this.writeSettingAuditLog("setting.updated", setting.id, setting.key, setting.value, actorUserId);

    return setting;
  }

  // --- Website CMS (structured JSON) --------------------------------------
  // First real use of Setting.value as an object/array rather than a
  // string or boolean — one fixed key per content section.

  async getHomepageHero(): Promise<HomepageHero> {
    return this.getJsonValue(CMS_KEYS.HOMEPAGE_HERO, DEFAULT_HERO);
  }

  async setHomepageHero(value: HomepageHero, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.HOMEPAGE_HERO, value, actorUserId);
  }

  async getBusinessInfo(): Promise<BusinessInfo> {
    return this.getJsonValue(CMS_KEYS.BUSINESS_INFO, DEFAULT_BUSINESS_INFO);
  }

  async setBusinessInfo(value: BusinessInfo, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.BUSINESS_INFO, value, actorUserId);
  }

  async getOtherRates(): Promise<OtherRateLine[]> {
    return this.getJsonValue(CMS_KEYS.OTHER_RATES, [] as OtherRateLine[]);
  }

  async setOtherRates(value: OtherRateLine[], actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.OTHER_RATES, value, actorUserId);
  }

  async getGalleryImages(): Promise<GalleryImage[]> {
    return this.getJsonValue(CMS_KEYS.GALLERY_IMAGES, [] as GalleryImage[]);
  }

  async setGalleryImages(value: GalleryImage[], actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.GALLERY_IMAGES, value, actorUserId);
  }

  // Merges over DEFAULT_COURT_HOURS (rather than returning the stored row
  // as-is like the other getX methods) because this shape has already
  // grown once — a row saved before facilityCloseTimes/
  // businessDateRolloverHour existed would otherwise come back missing
  // both and crash lib/court-hours.ts on the next read. Also transparently
  // migrates the old "24:00" no-cutoff sentinel (pre-BUILD-SPEC.md §0) to
  // today's "00:00" sentinel, so a stale stored value keeps working
  // instead of being silently misread as a literal cutoff.
  async getCourtHours(): Promise<CourtHoursSettings> {
    const stored = await this.getJsonValue<Partial<CourtHoursSettings>>(CMS_KEYS.COURT_HOURS, {});
    const courtCloseTimes = { ...DEFAULT_COURT_HOURS.courtCloseTimes, ...stored.courtCloseTimes };
    for (const [court, time] of Object.entries(courtCloseTimes)) {
      if (time === "24:00") {
        courtCloseTimes[court] = "00:00";
      }
    }

    return {
      ...DEFAULT_COURT_HOURS,
      ...stored,
      facilityCloseTimes: { ...DEFAULT_COURT_HOURS.facilityCloseTimes, ...stored.facilityCloseTimes },
      courtCloseTimes,
    };
  }

  async setCourtHours(value: CourtHoursSettings, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.COURT_HOURS, value, actorUserId);
  }

  // Merges over DEFAULT_OPEN_PLAY_SETTINGS rather than returning the
  // stored row as-is (same reasoning, same fix shape, as getCourtHours
  // above) — this shape has now grown twice in one session
  // (onlineRegistrationLeadTimeDays, then friSatRegistrationFeeCents).
  // Found live: a stored row saved before a field existed came back
  // missing it, and registerWalkIn's Sale creation crashed on
  // `amountCents` being undefined — not hypothetical, reproduced via a
  // real browser smoke test against the actual dev database.
  async getOpenPlaySettings(): Promise<OpenPlaySettings> {
    const stored = await this.getJsonValue<Partial<OpenPlaySettings>>(CMS_KEYS.OPEN_PLAY_SETTINGS, {});
    return { ...DEFAULT_OPEN_PLAY_SETTINGS, ...stored };
  }

  async setOpenPlaySettings(value: OpenPlaySettings, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.OPEN_PLAY_SETTINGS, value, actorUserId);
  }

  // Phase 10 Gate 1 (BUILD-SPEC.md §12/§13): lazily provisions the
  // unguessable slug /display/[slug] validates against, the first time
  // anything asks for it — same "no seeded Setting rows, everything is
  // created on first write" doctrine every other setting in this file
  // follows (see the class-level comment above). No real user initiates
  // this, so the audit trail records actorUserId: null rather than
  // borrowing an unrelated identity — see setJsonValue's comment.
  // create() (not upsert) is deliberate: it lets Postgres's own unique
  // index on Setting.key be the race guard between two concurrent first
  // callers, instead of two upserts silently overwriting each other with
  // two different slugs.
  async getOrCreateDisplaySlug(): Promise<string> {
    const existing = await this.getJsonValue<string | null>(DISPLAY_SLUG_KEY, null);
    if (existing) {
      return existing;
    }

    const slug = randomUUID();
    try {
      const setting = await prisma.setting.create({
        data: { key: DISPLAY_SLUG_KEY, value: slug, updatedById: null },
      });
      await this.writeSettingAuditLog("setting.updated", setting.id, setting.key, setting.value, null);
      return slug;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const row = await prisma.setting.findUniqueOrThrow({ where: { key: DISPLAY_SLUG_KEY } });
        return row.value as string;
      }
      throw error;
    }
  }

  // BUILD-SPEC.md §13's setup page: owner-only "Regenerate URL" — issues
  // a new slug and invalidates the old one (the TV display's own auth
  // model IS the slug; the old URL simply 404s once this overwrites it,
  // same as any other unguessable-token rotation in this app). Always an
  // update (never create — getOrCreateDisplaySlug already guarantees a
  // row exists by the time anyone can reach a page offering this
  // button).
  async regenerateDisplaySlug(actorUserId: string): Promise<string> {
    const slug = randomUUID();
    const setting = await prisma.setting.update({
      where: { key: DISPLAY_SLUG_KEY },
      data: { value: slug, updatedById: actorUserId },
    });
    await this.writeSettingAuditLog("setting.updated", setting.id, setting.key, setting.value, actorUserId);
    return slug;
  }

  private async getJsonValue<T>(key: string, fallback: T): Promise<T> {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  // actorUserId is nullable for the one genuinely-system-initiated write
  // this service does — getOrCreateDisplaySlug's self-provisioning, below
  // — which has no real user behind it and no natural existing system
  // identity to borrow (the seeded Website identity means "a public
  // booking," a semantic stretch for "the TV display bootstrapped its
  // own access token"). Setting.updatedById and AuditLog.userId are both
  // already nullable in schema for exactly this shape of event.
  private async setJsonValue<T>(key: string, value: T, actorUserId: string | null) {
    const setting = await prisma.setting.upsert({
      where: { key },
      update: { value: value as object, updatedById: actorUserId },
      create: { key, value: value as object, updatedById: actorUserId },
    });

    await this.writeSettingAuditLog("setting.updated", setting.id, setting.key, setting.value, actorUserId);

    return setting;
  }

  private async writeSettingAuditLog(
    action: string,
    settingId: string,
    key: string,
    value: unknown,
    actorUserId: string | null,
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: actorUserId,
          action,
          entityType: "Setting",
          entityId: settingId,
          newValues: toJsonValue({ key, value }),
        },
      });
    } catch (error) {
      logger.error({ err: error, action, userId: actorUserId }, "Failed to write audit log entry");
    }
  }
}

export const settingsService = new SettingsService();
