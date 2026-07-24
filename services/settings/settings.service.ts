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

// BUILD-SPEC.md §6 "Owner setting noShowReleaseMinutes, default 30."
const DEFAULT_OPEN_PLAY_SETTINGS: OpenPlaySettings = {
  noShowReleaseMinutes: 30,
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

  async getOpenPlaySettings(): Promise<OpenPlaySettings> {
    return this.getJsonValue(CMS_KEYS.OPEN_PLAY_SETTINGS, DEFAULT_OPEN_PLAY_SETTINGS);
  }

  async setOpenPlaySettings(value: OpenPlaySettings, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.OPEN_PLAY_SETTINGS, value, actorUserId);
  }

  private async getJsonValue<T>(key: string, fallback: T): Promise<T> {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }

  private async setJsonValue<T>(key: string, value: T, actorUserId: string) {
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
    actorUserId: string,
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
