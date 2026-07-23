import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { PUBLIC_VISIBILITY_KEYS } from "@/lib/public-visibility";
import { formatCurrency } from "@/lib/utils";
import { courtService } from "@/services/court/court.service";
import { productService } from "@/services/products/product.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Rates",
  description: "Court rental rates and pricing.",
};

export const dynamic = "force-dynamic";

export default async function RatesPage() {
  const [courts, otherRates, products, visibility] = await Promise.all([
    courtService.listCourts(),
    settingsService.getOtherRates(),
    productService.listActiveProducts(),
    settingsService.getPublicVisibility(),
  ]);

  const visibleCourts = courts.filter((court) => court.status !== "DISABLED");
  const showProducts = visibility[PUBLIC_VISIBILITY_KEYS.PRODUCTS];

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Rates</h1>
          <p className="text-muted-foreground mt-2 text-lg">Simple, transparent pricing.</p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className="font-heading text-xl font-semibold">Court rental</h2>
          <div className="divide-border divide-y rounded-xl border">
            {visibleCourts.map((court) => (
              <div key={court.id} className="flex justify-between px-4 py-3 text-sm">
                <span>{court.name}</span>
                <span className="font-medium">
                  {court.hourlyRateCents != null ? `${formatCurrency(court.hourlyRateCents)}/hr` : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {otherRates.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-xl font-semibold">Other pricing</h2>
            <div className="divide-border divide-y rounded-xl border">
              {otherRates.map((rate, index) => (
                <div key={`${rate.label}-${index}`} className="flex justify-between px-4 py-3 text-sm">
                  <span>{rate.label}</span>
                  <span className="font-medium">{rate.priceText}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {showProducts && products.length > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="font-heading text-xl font-semibold">In the shop</h2>
            <div className="divide-border divide-y rounded-xl border">
              {products.map((product) => (
                <div key={product.id} className="flex justify-between px-4 py-3 text-sm">
                  <span>{product.name}</span>
                  <span className="font-medium">{formatCurrency(product.priceCents)}</span>
                </div>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">Available for purchase at the venue.</p>
          </section>
        ) : null}

        <Link href="/book" className={buttonVariants({ size: "lg" })}>
          Book Now
        </Link>
      </main>
      <SiteFooter />
    </div>
  );
}
