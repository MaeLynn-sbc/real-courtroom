"use server";

import { revalidatePath } from "next/cache";

import {
  businessInfoSchema,
  galleryImagesSchema,
  homepageHeroSchema,
  otherRatesSchema,
  type BusinessInfo,
  type GalleryImage,
  type HomepageHero,
  type OtherRateLine,
} from "@/features/cms/schemas/cms.schema";
import { requireSystemAdmin } from "@/lib/action-auth";
import { toActionError } from "@/lib/errors";
import type { PublicVisibilityKey } from "@/lib/public-visibility";
import { settingsService } from "@/services/settings/settings.service";
import { getUploadService } from "@/services/upload/upload-service.factory";

export interface CmsActionState {
  error: string | null;
}

function requireWebsiteAdmin() {
  return requireSystemAdmin("You don't have permission to manage the website.");
}

// Every public page reading CMS content is server-rendered — bust them
// all alongside the admin panel itself so an edit shows up immediately.
function revalidatePublicSite(): void {
  revalidatePath("/dashboard/admin/website");
  revalidatePath("/");
  revalidatePath("/about");
  revalidatePath("/contact");
  revalidatePath("/rates");
  revalidatePath("/open-play");
}

export async function setHomepageHeroAction(input: HomepageHero): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = homepageHeroSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid hero content." };
  }

  try {
    await settingsService.setHomepageHero(parsed.data, authz.userId);
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setHomepageHeroAction", userId: authz.userId }) };
  }
}

export async function setBusinessInfoAction(input: BusinessInfo): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = businessInfoSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid business info." };
  }

  try {
    await settingsService.setBusinessInfo(parsed.data, authz.userId);
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setBusinessInfoAction", userId: authz.userId }) };
  }
}

export async function setOtherRatesAction(input: OtherRateLine[]): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = otherRatesSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid rates." };
  }

  try {
    await settingsService.setOtherRates(parsed.data, authz.userId);
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setOtherRatesAction", userId: authz.userId }) };
  }
}

const MAX_GALLERY_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface UploadGalleryImageState extends CmsActionState {
  image?: GalleryImage;
}

export async function uploadGalleryImageAction(formData: FormData): Promise<UploadGalleryImageState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose an image to upload." };
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { error: "Only PNG, JPEG, WebP, or GIF images are allowed." };
  }
  if (file.size > MAX_GALLERY_IMAGE_BYTES) {
    return { error: "Image must be 5MB or smaller." };
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await getUploadService().upload({
      fileName: file.name,
      contentType: file.type,
      data: buffer,
    });

    const existing = await settingsService.getGalleryImages();
    const image: GalleryImage = { url: result.url, alt: "" };
    await settingsService.setGalleryImages([...existing, image], authz.userId);
    revalidatePublicSite();
    return { error: null, image };
  } catch (error) {
    return { error: toActionError(error, { action: "uploadGalleryImageAction", userId: authz.userId }) };
  }
}

export async function removeGalleryImageAction(url: string): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    const existing = await settingsService.getGalleryImages();
    await settingsService.setGalleryImages(
      existing.filter((image) => image.url !== url),
      authz.userId,
    );
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "removeGalleryImageAction", userId: authz.userId }) };
  }
}

export async function reorderGalleryImagesAction(images: GalleryImage[]): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  const parsed = galleryImagesSchema.safeParse(images);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid gallery order." };
  }

  try {
    await settingsService.setGalleryImages(parsed.data, authz.userId);
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "reorderGalleryImagesAction", userId: authz.userId }) };
  }
}

export async function setPublicVisibilityAction(
  key: PublicVisibilityKey,
  visible: boolean,
): Promise<CmsActionState> {
  const authz = await requireWebsiteAdmin();
  if (!authz.ok) {
    return { error: authz.error };
  }

  try {
    await settingsService.setPublicVisibility(key, visible, authz.userId);
    revalidatePublicSite();
    return { error: null };
  } catch (error) {
    return { error: toActionError(error, { action: "setPublicVisibilityAction", userId: authz.userId }) };
  }
}
