import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CourtAvailabilityGrid } from "@/features/bookings/components/court-availability-grid";

export const metadata: Metadata = {
  title: "Court Availability",
  description: "Live court schedule — see what's available today.",
};

// Same reason as the home page's own docket section — a CMS/booking
// change must show up immediately, not after the next rebuild.
export const dynamic = "force-dynamic";

interface AvailabilityPageProps {
  searchParams: Promise<{ date?: string }>;
}

export default async function AvailabilityPage({ searchParams }: AvailabilityPageProps) {
  const { date: dateParam } = await searchParams;
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  return (
    <div className="bg-navy-900 flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="flex-1 px-6 py-[clamp(40px,5vw,64px)]">
        <div className="mx-auto max-w-6xl">
          <CourtAvailabilityGrid date={date} basePath="/availability" />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
