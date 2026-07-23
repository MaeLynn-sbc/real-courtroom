import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { courtService } from "@/services/court/court.service";

export const metadata: Metadata = {
  title: "Courts",
  description: "Our indoor pickleball courts.",
};

export const dynamic = "force-dynamic";

export default async function CourtsPage() {
  const courts = await courtService.listCourts();
  const visibleCourts = courts.filter((court) => court.status !== "DISABLED");

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Our Courts</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            {visibleCourts.length} indoor court{visibleCourts.length === 1 ? "" : "s"}, ready to play.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleCourts.map((court) => (
            <div key={court.id} className="flex flex-col gap-2 rounded-xl border p-5">
              <p className="font-heading text-lg font-semibold">{court.name}</p>
              <p className="text-muted-foreground text-sm">{court.indoor ? "Indoor" : "Outdoor"} court</p>
              {court.hourlyRateCents != null ? (
                <p className="text-sm font-medium">{formatCurrency(court.hourlyRateCents)}/hr</p>
              ) : null}
            </div>
          ))}
        </div>
        <div className="flex gap-3">
          <Link href="/book" className={buttonVariants({ size: "lg" })}>
            Book a court
          </Link>
          <Link href="/availability" className={buttonVariants({ variant: "outline", size: "lg" })}>
            View live availability
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
