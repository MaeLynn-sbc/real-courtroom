import type { Metadata } from "next";

import { BusinessInfoPanel } from "@/features/cms/components/business-info-panel";
import { GalleryPanel } from "@/features/cms/components/gallery-panel";
import { HeroPanel } from "@/features/cms/components/hero-panel";
import { PublicVisibilityPanel } from "@/features/cms/components/public-visibility-panel";
import { RatesPanel } from "@/features/cms/components/rates-panel";
import { courtService } from "@/services/court/court.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Website",
};

export const dynamic = "force-dynamic";

export default async function WebsiteCmsPage() {
  const [hero, businessInfo, otherRates, galleryImages, visibility, courts] = await Promise.all([
    settingsService.getHomepageHero(),
    settingsService.getBusinessInfo(),
    settingsService.getOtherRates(),
    settingsService.getGalleryImages(),
    settingsService.getPublicVisibility(),
    courtService.listCourts(),
  ]);

  const courtRates = courts
    .filter((court) => court.status !== "DISABLED")
    .map((court) => ({ id: court.id, name: court.name, hourlyRateCents: court.hourlyRateCents }));

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Website</h1>
        <p className="text-muted-foreground text-sm">
          Content shown on the public website — changes appear immediately, no redeploy needed.
        </p>
      </div>

      <HeroPanel hero={hero} galleryImages={galleryImages} />
      <BusinessInfoPanel businessInfo={businessInfo} />
      <RatesPanel courtRates={courtRates} otherRates={otherRates} />
      <GalleryPanel images={galleryImages} />
      <PublicVisibilityPanel visibility={visibility} />
    </div>
  );
}
