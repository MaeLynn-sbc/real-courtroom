import type { Metadata } from "next";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with The Courtroom.",
};

export const dynamic = "force-dynamic";

export default async function ContactPage() {
  const businessInfo = await settingsService.getBusinessInfo();

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Contact Us</h1>
          <p className="text-muted-foreground mt-2 text-lg">We&apos;d love to hear from you.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {businessInfo.phone ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Phone</p>
              <p className="mt-1 text-sm font-medium">{businessInfo.phone}</p>
            </div>
          ) : null}
          {businessInfo.email ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Email</p>
              <p className="mt-1 text-sm font-medium">{businessInfo.email}</p>
            </div>
          ) : null}
          {businessInfo.address ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Address</p>
              <p className="mt-1 text-sm font-medium">{businessInfo.address}</p>
            </div>
          ) : null}
          {businessInfo.hours ? (
            <div className="rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Hours</p>
              <p className="mt-1 text-sm font-medium">{businessInfo.hours}</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-4 text-sm">
          {businessInfo.facebookUrl ? (
            <a
              href={businessInfo.facebookUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary font-medium hover:underline"
            >
              Follow us on Facebook
            </a>
          ) : null}
          {businessInfo.mapsUrl ? (
            <a
              href={businessInfo.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary font-medium hover:underline"
            >
              Get directions on Google Maps
            </a>
          ) : null}
        </div>

        {businessInfo.mapsUrl ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl border">
            <iframe
              src={businessInfo.mapsUrl}
              title="Location map"
              className="h-full w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
