import { Trophy } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { CourtAvailabilityGrid } from "@/features/bookings/components/court-availability-grid";
import { announcementService } from "@/services/notifications/announcement.service";
import { settingsService } from "@/services/settings/settings.service";

// Without this, Next prerenders the homepage at build time (no
// searchParams/dynamic segment/auth() call to signal otherwise) and a
// CMS edit to the hero/gallery/announcements would never show up in
// production without a rebuild — see ARCHITECTURE.md's Phase 4 addendum
// for the same bug pattern found and fixed on the booking form.
export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [{ date: dateParam }, hero, galleryImages, announcements] = await Promise.all([
    searchParams,
    settingsService.getHomepageHero(),
    settingsService.getGalleryImages(),
    announcementService.listPublished(),
  ]);
  const latestAnnouncement = announcements[0];
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="bg-background relative flex flex-1 items-center overflow-hidden">
        {/* Faint pickleball-court line grid — pure CSS, background-attachment:
            fixed gives a cheap, dependency-free parallax feel on scroll. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 opacity-[0.05]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, transparent, transparent 79px, currentColor 79px, currentColor 80px), repeating-linear-gradient(90deg, transparent, transparent 79px, currentColor 79px, currentColor 80px)",
            backgroundAttachment: "fixed",
            color: "var(--foreground)",
          }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 18% 20%, oklch(0.62 0.17 135 / 0.14), transparent 45%), radial-gradient(circle at 82% 78%, oklch(0.58 0.1 250 / 0.14), transparent 45%)",
          }}
        />

        <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-24 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div className="flex flex-col items-start gap-6">
            <span className="bg-brand/10 text-brand animate-in fade-in slide-in-from-bottom-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium duration-700">
              <Trophy className="size-3.5" aria-hidden="true" />
              Indoor Pickleball, Done Right
            </span>
            <h1 className="hero-3d-text font-heading animate-in fade-in slide-in-from-bottom-4 text-6xl leading-[0.95] font-extrabold tracking-tight text-balance delay-100 duration-700 sm:text-7xl md:text-8xl">
              {hero.title}
            </h1>
            {hero.subtitle ? (
              <p className="text-muted-foreground animate-in fade-in slide-in-from-bottom-4 max-w-xl text-lg text-balance delay-200 duration-700">
                {hero.subtitle}
              </p>
            ) : null}
            {latestAnnouncement ? (
              <p className="border-warning/40 bg-warning/10 text-foreground animate-in fade-in rounded-lg border px-3 py-2 text-sm delay-200 duration-700">
                <span className="font-medium">{latestAnnouncement.title}</span> — {latestAnnouncement.body}
              </p>
            ) : null}
            <Link
              href="/book"
              className={`${buttonVariants({ size: "lg" })} animate-in fade-in slide-in-from-bottom-4 delay-300 duration-700`}
            >
              {hero.ctaText}
            </Link>
          </div>

          {hero.imageUrl ? (
            <div className="animate-in fade-in relative aspect-[4/3] w-full overflow-hidden rounded-2xl shadow-lg delay-300 duration-700">
              <Image src={hero.imageUrl} alt={hero.title} fill className="object-cover" priority />
            </div>
          ) : null}
        </div>
      </main>

      <section className="border-border/60 border-t px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <CourtAvailabilityGrid date={date} />
        </div>
      </section>

      {galleryImages.length > 0 ? (
        <section className="border-border/60 border-t px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-heading mb-6 text-2xl font-semibold tracking-tight">Gallery</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {galleryImages.slice(0, 8).map((image) => (
                <div key={image.url} className="relative aspect-square overflow-hidden rounded-xl">
                  <Image src={image.url} alt={image.alt || "The Courtroom"} fill className="object-cover" />
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <SiteFooter />
    </div>
  );
}
