import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TvDisplayClient } from "@/features/display/components/tv-display-client";
import { displayService } from "@/services/display/display.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Court Status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

interface DisplayPageProps {
  params: Promise<{ slug: string }>;
}

// BUILD-SPEC.md §1/§12: "auth-free — a smart TV browser cannot stay
// signed in. Use an unguessable path segment." middleware.ts's matcher
// is scoped to /dashboard/:path* only, so this route is reachable with
// no session by construction; the slug below is the only gate, and it
// gates discovery of the page, not the underlying data (see
// app/api/display/route.ts's comment — that endpoint is unparameterized
// and already public-safe on its own).
export default async function DisplayPage({ params }: DisplayPageProps) {
  const { slug } = await params;
  const expectedSlug = await settingsService.getOrCreateDisplaySlug();

  if (slug !== expectedSlug) {
    notFound();
  }

  const initialData = await displayService.getDisplayData();

  return <TvDisplayClient initialData={initialData} />;
}
