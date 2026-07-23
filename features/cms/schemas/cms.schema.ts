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
