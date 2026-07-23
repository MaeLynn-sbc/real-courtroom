import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "About",
  description: "About The Courtroom — indoor pickleball courts, open play, and more.",
};

export const dynamic = "force-dynamic";

export default async function AboutPage() {
  const businessInfo = await settingsService.getBusinessInfo();

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
        <h1 className="font-heading text-4xl font-semibold tracking-tight">
          About {businessInfo.name}
        </h1>
        <p className="text-muted-foreground text-lg">
          {businessInfo.name} is an indoor pickleball facility offering court bookings, open play
          sessions, and a home for players of every level.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {businessInfo.address ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Address</p>
              <p className="mt-1 text-sm">{businessInfo.address}</p>
            </div>
          ) : null}
          {businessInfo.hours ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                Operating hours
              </p>
              <p className="mt-1 text-sm">{businessInfo.hours}</p>
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
