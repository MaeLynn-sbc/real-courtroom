import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { buttonVariants } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachRateService } from "@/services/coaching/coach-rate.service";

export const metadata: Metadata = {
  title: "Coaching",
  description: "Meet our coaches, see rates, and find a time that works.",
};

export const dynamic = "force-dynamic";

function groupSizeLabel(groupSize: number): string {
  return `${groupSize} ${groupSize === 1 ? "player" : "players"}`;
}

export default async function CoachesPage() {
  const coaches = await coachAvailabilityService.listCoaches();
  const coachesWithRates = await Promise.all(
    coaches.map(async (coach) => ({
      coach,
      rates: await coachRateService.listRates(coach.id),
    })),
  );

  return (
    <div className="flex min-h-svh flex-1 flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-16">
        <div>
          <h1 className="font-heading text-4xl font-semibold tracking-tight">Coaching</h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Private and group lessons with our coaches — book a court, then add one.
          </p>
        </div>

        <section className="rounded-xl border p-4">
          <h2 className="font-heading text-lg font-semibold">How it works</h2>
          <p className="text-muted-foreground mt-2 text-sm">
            Coaching is added on top of a court booking — you&apos;re never booking a coach on their own.
            When you book a court, you&apos;ll have the option to add a coach for that session, pick a group
            size, and see the exact rate before you confirm. The coach&apos;s fee is charged in addition to
            the court&apos;s hourly rate, shown separately so you know exactly what you&apos;re paying for
            before you reach checkout.
          </p>
        </section>

        {coachesWithRates.length === 0 ? (
          <p className="text-muted-foreground text-sm">No coaches are set up yet — check back soon.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {coachesWithRates.map(({ coach, rates }) => (
              <section key={coach.id} className="rounded-xl border p-4">
                <div className="flex flex-col gap-4 sm:flex-row">
                  {coach.photoUrl ? (
                    <Image
                      src={coach.photoUrl}
                      alt={`${coach.firstName} ${coach.lastName}`}
                      width={120}
                      height={120}
                      unoptimized
                      className="size-28 shrink-0 self-start rounded-xl border object-cover"
                    />
                  ) : null}
                  <div className="flex flex-1 flex-col gap-2">
                    <h2 className="font-heading text-xl font-semibold">
                      {coach.firstName} {coach.lastName}
                    </h2>
                    {coach.bio ? (
                      <p className="text-muted-foreground text-sm whitespace-pre-line">{coach.bio}</p>
                    ) : null}
                  </div>
                </div>

                {rates.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                      Rates
                    </p>
                    <div className="divide-border divide-y rounded-lg border">
                      {rates.map((rate) => (
                        <div key={rate.id} className="flex justify-between px-4 py-2.5 text-sm">
                          <span>{groupSizeLabel(rate.groupSize)}</span>
                          <span className="font-medium">{formatCurrency(rate.priceCents)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      Per session, on top of the court&apos;s hourly rate.
                    </p>
                  </div>
                ) : (
                  <p className="text-muted-foreground mt-4 text-sm">Rates coming soon — ask at the desk.</p>
                )}
              </section>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Link href="/book" className={buttonVariants({ size: "lg" })}>
            Book a court
          </Link>
          <Link href="/coaches/availability" className={buttonVariants({ variant: "outline", size: "lg" })}>
            See coach availability
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
