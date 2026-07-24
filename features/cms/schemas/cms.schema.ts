import { z } from "zod";

export const homepageHeroSchema = z.object({
  title: z.string().min(1, "Enter a hero title.").max(100),
  subtitle: z.string().max(300),
  ctaText: z.string().min(1, "Enter a button label.").max(40),
  imageUrl: z.string().max(500).nullable(),
});

export type HomepageHero = z.infer<typeof homepageHeroSchema>;

export const businessInfoSchema = z.object({
  name: z.string().min(1, "Enter a business name.").max(200),
  phone: z.string().max(50),
  email: z.string().max(200),
  address: z.string().max(300),
  hours: z.string().max(300),
  facebookUrl: z.string().max(300),
  mapsUrl: z.string().max(500),
});

export type BusinessInfo = z.infer<typeof businessInfoSchema>;

export const otherRateLineSchema = z.object({
  label: z.string().min(1, "Enter a label.").max(120),
  priceText: z.string().min(1, "Enter a price.").max(60),
});

export type OtherRateLine = z.infer<typeof otherRateLineSchema>;

export const otherRatesSchema = z.array(otherRateLineSchema).max(50);

export const galleryImageSchema = z.object({
  url: z.string().min(1),
  alt: z.string().max(200),
});

export type GalleryImage = z.infer<typeof galleryImageSchema>;

export const galleryImagesSchema = z.array(galleryImageSchema).max(50);

// Plain "HH:MM" 24-hour time. "00:00" is a valid value everywhere this is
// used — for courtCloseTimes specifically it doubles as a sentinel (see
// courtHoursSchema below), not a real midnight cutoff.
const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM format.");

// BUILD-SPEC.md §0. Fixed weekday keys "0"-"6" (Sun-Sat, Date#getDay()
// convention) — z.record needs string keys, JSON can't hold numeric ones.
const weekdayTimesSchema = z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), timeStringSchema);

export const courtHoursSchema = z.object({
  facilityOpenTime: timeStringSchema,
  // The building's own closing time per weekday — a hard cap independent
  // of any court's individual cutoff below (BUILD-SPEC.md §0 "Facility
  // close is a PUBLIC limit, not a data limit"). Default 23:00 every day.
  facilityCloseTimes: weekdayTimesSchema,
  fridaySaturdayCloseTime: timeStringSchema,
  // Keyed by court name. "00:00" means "no per-court cutoff" — the court
  // is bookable right up to facilityCloseTimes for that weekday. It's a
  // sentinel, not a real midnight cutoff (BUILD-SPEC.md §0).
  courtCloseTimes: z.record(z.string(), timeStringSchema),
  // BUILD-SPEC.md §0 "Business date vs calendar date" — the hour at which
  // a new business day starts for reporting purposes (default 3AM), so a
  // session that runs past midnight still reports under the night it
  // started. See lib/business-date.ts.
  businessDateRolloverHour: z.number().int().min(0).max(23),
});

export type CourtHoursSettings = z.infer<typeof courtHoursSchema>;

// BUILD-SPEC.md §6/§7 owner settings for open play operations.
export const openPlaySettingsSchema = z.object({
  // BUILD-SPEC.md §6 "No-shows... default 30." A Fri/Sat registration not
  // checked in within this many minutes of session start is released.
  noShowReleaseMinutes: z.number().int().positive(),
  // BUILD-SPEC.md §7 "Starvation guard... default 20." Any waiting player
  // past this many minutes is force-anchored on the next court regardless
  // of skill fit.
  maxWaitMinutes: z.number().int().positive(),
  // BUILD-SPEC.md §7 "skill distance 1 of the anchor" — starting candidate
  // skill-level distance before widening to 2, then any level.
  skillWindow: z.number().int().min(0),
  // BUILD-SPEC.md §7 "An owner setting controls whether proposals
  // auto-confirm after N seconds." Off by default — this app has no
  // scheduler, so "after N seconds" isn't implemented; this flag is a
  // placeholder for when/if that becomes worth building.
  autoConfirmProposals: z.boolean(),
  // BUILD-SPEC.md §7 "informational, default 15" — not enforced anywhere,
  // shown to staff as a rough target only.
  targetGameMinutes: z.number().int().positive(),
});

export type OpenPlaySettings = z.infer<typeof openPlaySettingsSchema>;
