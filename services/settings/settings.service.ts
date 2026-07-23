import type {
  BusinessInfo,
  CourtHoursSettings,
  GalleryImage,
  HomepageHero,
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

// Matches the facility's actual current hours — Court 1 until 6pm, Court 2
// until 8pm, Court 3 until midnight, everyone until 6pm on Fri/Sat — so a
// facility with no admin edits yet behaves exactly as it does today.
const DEFAULT_COURT_HOURS: CourtHoursSettings = {
  facilityOpenTime: "07:00",
  fridaySaturdayCloseTime: "18:00",
  courtCloseTimes: {
    "Court 1": "18:00",
    "Court 2": "20:00",
    "Court 3": "24:00",
  },
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

  async getCourtHours(): Promise<CourtHoursSettings> {
    return this.getJsonValue(CMS_KEYS.COURT_HOURS, DEFAULT_COURT_HOURS);
  }

  async setCourtHours(value: CourtHoursSettings, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.COURT_HOURS, value, actorUserId);
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
