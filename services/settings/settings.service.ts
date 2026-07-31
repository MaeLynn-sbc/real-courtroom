import { randomUUID } from "node:crypto";

import type {
  BusinessInfo,
  CourtHoursSettings,
  GalleryImage,
  GcashPaymentInfo,
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

// How long an unpaid public booking hold (createBookingHold) reserves
// a slot before the customer must actually pay. Same small-object
// convention as DISPLAY_TIME_UP_FLASH_KEY below. Default 30 minutes —
// matches Open Play's own, separately-defined hold window
// (open-play-registration.service.ts's HOLD_DURATION_MINUTES), and
// was previously a hardcoded 4 hours in booking.service.ts: long
// enough that a single visitor could hold every court for most of a
// day with no payment and no consequence. 30 minutes gives a real
// customer real margin to open GCash and send money; it stops being
// enough runway for someone to lock up the whole schedule for free.
const BOOKING_HOLD_KEY = "booking.holdMinutes";
interface BookingHoldSettings {
  holdMinutes: number;
}
const DEFAULT_BOOKING_HOLD: BookingHoldSettings = { holdMinutes: 30 };

// Phase 10 Gate 1 — see getOrCreateDisplaySlug. An unguessable path
// component (not a permission check) standing in for "the TV display's
// URL isn't listed anywhere a random visitor would find it" — the route
// itself is intentionally login-free per BUILD-SPEC.md §12/§13.
const DISPLAY_SLUG_KEY = "display.slug";

// TV display voice announcements: how many times each court-assignment
// announcement plays (a noisy indoor court means people miss the first
// pass). Stored as a small object rather than a bare number to match
// this file's own JSON-value convention (getJsonValue/setJsonValue),
// not because the shape needs to grow.
const DISPLAY_ANNOUNCEMENT_REPEAT_KEY = "display.announcementRepeat";
interface AnnouncementRepeatSettings {
  repeatCount: number;
}
const DEFAULT_ANNOUNCEMENT_REPEAT: AnnouncementRepeatSettings = { repeatCount: 2 };

// TV display poll interval: how often the kiosk (and now /phone —
// features/display/components/phone-display-client.tsx, its own
// independent 10s constant, not driven by this setting) re-fetches
// /api/display. Approved earlier this session and never actually built;
// building it now. Load reconsidered specifically for the multi-client
// case now that /phone exists (previously just one TV kiosk polling):
// /api/display costs ~8-9 small, indexed queries per call (traced
// earlier), no unbounded scans. Even dozens of phones at 10s each plus
// one TV at 10s is on the order of a handful of requests/second at this
// venue's scale — still trivial for Postgres. Default dropped from the
// old hardcoded 30s to 10s, matching /phone's own interval, so both
// surfaces feel equally live. New-assignment detection (courtAssignment
// Signature in tv-display-client.tsx) is a pure diff against the
// PREVIOUS poll's signature, run BEFORE any announcement fires — an
// unchanged assignment never re-announces regardless of how often that
// diff runs, so a faster interval doesn't introduce any new duplicate-
// announcement risk; this was already true at 30s and stays true here.
const DISPLAY_REFRESH_INTERVAL_KEY = "display.refreshInterval";
interface DisplayRefreshIntervalSettings {
  intervalSeconds: number;
}
const DEFAULT_DISPLAY_REFRESH_INTERVAL: DisplayRefreshIntervalSettings = { intervalSeconds: 10 };

// TV display "time's up" flash: how long a court's card keeps flashing
// after its booking's end time before stopping on its own. Same small-
// object convention as DISPLAY_ANNOUNCEMENT_REPEAT_KEY just above.
// Default 180s (3 minutes) — long enough to be clearly noticed from
// across the room even if nobody's looking right at that moment it
// starts, short enough it isn't still flashing by the time anyone
// walks over to check.
const DISPLAY_TIME_UP_FLASH_KEY = "display.timeUpFlash";
interface TimeUpFlashSettings {
  durationSeconds: number;
}
const DEFAULT_TIME_UP_FLASH: TimeUpFlashSettings = { durationSeconds: 180 };

// TV display voice announcements: which SpeechSynthesisVoice to use.
// Reported live: the announcement voice changed from female to male on
// its own — the code never specified one, so it rode whatever the
// browser/OS considered the default, which a browser or OS update on
// the display machine can silently change. name+lang (not voiceURI,
// which some browsers leave blank or don't expose consistently) is the
// same pair the Web Speech API itself uses to identify a
// SpeechSynthesisVoice, and is exactly what the TV client matches
// against its OWN speechSynthesis.getVoices() at runtime — voices are a
// property of the device playing them, not the server, so this setting
// is a NAME to look up locally, not a value the server can enforce.
// null (the default) means "no preference set" — same as today's actual
// behavior (browser default), so an unconfigured venue sees no change.
const DISPLAY_ANNOUNCEMENT_VOICE_KEY = "display.announcementVoice";
interface AnnouncementVoiceSettings {
  voice: { name: string; lang: string } | null;
}
const DEFAULT_ANNOUNCEMENT_VOICE: AnnouncementVoiceSettings = { voice: null };

// TV display "one minute remaining" warning for a running open-play
// game — reported live: the assignment announcement is deliberately
// manual (players take time to walk over, so that timing depends on a
// human), but this one is purely clock-driven, relative to the timer
// staff already started manually — no human judgment involved, so it
// can fire on its own. Same lazy-on-read pattern as isTimeUpFlashing:
// derived from a court's own endAt at render/poll time, no scheduler.
// minutes is owner-editable (some venues want 2, not just 1) — same
// small-object convention as this file's other display settings.
// enabled defaults true: this is a feature staff explicitly asked to be
// built and want active, not an opt-in add-on nobody's seen yet.
const DISPLAY_GAME_WARNING_KEY = "display.gameWarning";
interface GameWarningSettings {
  enabled: boolean;
  minutes: number;
}
const DEFAULT_GAME_WARNING: GameWarningSettings = { enabled: true, minutes: 1 };

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

// Equipment page toggle — hides just the LOW_STOCK alert type from the
// Equipment page's own banner (services/inventory/inventory-alerts.service.ts's
// fixed threshold flags any item with availableQuantity <= 2 as "low
// stock" even when nothing is actually rented out, e.g. a 2-of-2-owned
// Ball Machine). UNRESOLVED_DAMAGE/OVERDUE_EQUIPMENT_RENTAL alerts are
// real operational problems and are unaffected by this — see
// app/dashboard/equipment/page.tsx's own filter. Default false (shown,
// today's behavior) via getBooleanFlags' shared "no row -> false".
const EQUIPMENT_HIDE_LOW_STOCK_ALERT_KEY = "equipment.hideLowStockAlert";

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
  // Manual timer/announce: 3 minutes, per the user's own "default maybe
  // 3 minutes" ask.
  forgottenAssignmentNudgeMinutes: 3,
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

  async getBookingHoldMinutes(): Promise<number> {
    const stored = await this.getJsonValue<BookingHoldSettings>(BOOKING_HOLD_KEY, DEFAULT_BOOKING_HOLD);
    return stored.holdMinutes;
  }

  async setBookingHoldMinutes(value: number, actorUserId: string) {
    return this.setJsonValue(BOOKING_HOLD_KEY, { holdMinutes: value }, actorUserId);
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

  async getEquipmentHideLowStockAlert(): Promise<boolean> {
    const flags = await this.getBooleanFlags([EQUIPMENT_HIDE_LOW_STOCK_ALERT_KEY]);
    return flags[EQUIPMENT_HIDE_LOW_STOCK_ALERT_KEY];
  }

  async setEquipmentHideLowStockAlert(value: boolean, actorUserId: string) {
    return this.setBooleanFlag(EQUIPMENT_HIDE_LOW_STOCK_ALERT_KEY, value, actorUserId);
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

  // Owner decision: one static GCash QR + account name/number, shown to
  // every customer on the payment step (both court bookings and open
  // play). No row yet -> nulls/blanks, same "absence means not
  // configured yet" doctrine as every other CMS default here.
  async getGcashPaymentInfo(): Promise<GcashPaymentInfo> {
    return this.getJsonValue(CMS_KEYS.GCASH_PAYMENT_INFO, {
      qrImageUrl: null,
      accountName: "",
      accountNumber: "",
    } as GcashPaymentInfo);
  }

  async setGcashPaymentInfo(value: GcashPaymentInfo, actorUserId: string) {
    return this.setJsonValue(CMS_KEYS.GCASH_PAYMENT_INFO, value, actorUserId);
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

  async getDisplayRefreshIntervalSeconds(): Promise<number> {
    const stored = await this.getJsonValue<DisplayRefreshIntervalSettings>(
      DISPLAY_REFRESH_INTERVAL_KEY,
      DEFAULT_DISPLAY_REFRESH_INTERVAL,
    );
    return stored.intervalSeconds;
  }

  async setDisplayRefreshIntervalSeconds(value: number, actorUserId: string) {
    return this.setJsonValue(DISPLAY_REFRESH_INTERVAL_KEY, { intervalSeconds: value }, actorUserId);
  }

  async getAnnouncementRepeatCount(): Promise<number> {
    const stored = await this.getJsonValue<AnnouncementRepeatSettings>(
      DISPLAY_ANNOUNCEMENT_REPEAT_KEY,
      DEFAULT_ANNOUNCEMENT_REPEAT,
    );
    return stored.repeatCount;
  }

  async setAnnouncementRepeatCount(value: number, actorUserId: string) {
    return this.setJsonValue(DISPLAY_ANNOUNCEMENT_REPEAT_KEY, { repeatCount: value }, actorUserId);
  }

  async getTimeUpFlashDurationSeconds(): Promise<number> {
    const stored = await this.getJsonValue<TimeUpFlashSettings>(
      DISPLAY_TIME_UP_FLASH_KEY,
      DEFAULT_TIME_UP_FLASH,
    );
    return stored.durationSeconds;
  }

  async setTimeUpFlashDurationSeconds(value: number, actorUserId: string) {
    return this.setJsonValue(DISPLAY_TIME_UP_FLASH_KEY, { durationSeconds: value }, actorUserId);
  }

  async getAnnouncementVoice(): Promise<{ name: string; lang: string } | null> {
    const stored = await this.getJsonValue<AnnouncementVoiceSettings>(
      DISPLAY_ANNOUNCEMENT_VOICE_KEY,
      DEFAULT_ANNOUNCEMENT_VOICE,
    );
    return stored.voice;
  }

  async setAnnouncementVoice(value: { name: string; lang: string } | null, actorUserId: string) {
    return this.setJsonValue(DISPLAY_ANNOUNCEMENT_VOICE_KEY, { voice: value }, actorUserId);
  }

  async getGameWarningSettings(): Promise<GameWarningSettings> {
    return this.getJsonValue<GameWarningSettings>(DISPLAY_GAME_WARNING_KEY, DEFAULT_GAME_WARNING);
  }

  async setGameWarningSettings(value: GameWarningSettings, actorUserId: string) {
    return this.setJsonValue(DISPLAY_GAME_WARNING_KEY, value, actorUserId);
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
