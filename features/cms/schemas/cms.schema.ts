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

// "HH:MM" 24-hour time, plus the literal "24:00" sentinel for midnight —
// courtCloseTimes needs to express "open until midnight" (Court 3's
// default), which a plain 00-23 hour range can't represent.
const timeStringSchema = z
  .string()
  .refine((value) => value === "24:00" || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), {
    message: "Use 24-hour HH:MM format (or 24:00 for midnight).",
  });

export const courtHoursSchema = z.object({
  facilityOpenTime: timeStringSchema,
  fridaySaturdayCloseTime: timeStringSchema,
  // Keyed by court name — a court with no entry here is treated as open
  // until midnight every day it isn't Friday/Saturday.
  courtCloseTimes: z.record(z.string(), timeStringSchema),
});

export type CourtHoursSettings = z.infer<typeof courtHoursSchema>;
