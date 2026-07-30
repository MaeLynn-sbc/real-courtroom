import { unstable_cache } from "next/cache";
import Image from "next/image";
import Link from "next/link";

import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { CourtAvailabilityGrid } from "@/features/bookings/components/court-availability-grid";
import { getCourtBookingWindow, getFacilityCloseMinutes } from "@/lib/court-hours";
import { EQUIPMENT_KEYS } from "@/lib/equipment-keys";
import { formatCurrency } from "@/lib/utils";
import { equipmentService } from "@/services/equipment/equipment.service";
import { announcementService } from "@/services/notifications/announcement.service";
import { openPlayCapacityService, type UpcomingOpenPlayNight } from "@/services/open-play/open-play-capacity.service";
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

const PILL_BUTTON =
  "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";

function formatTimeOfDay(time: string): string {
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const period = hours < 12 ? "AM" : "PM";
  const twelveHour = ((hours + 11) % 12) + 1;
  return minutesText === "00" ? `${twelveHour}${period}` : `${twelveHour}:${minutesText} ${period}`;
}

function formatMinutesOfDay(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  const mins = minutes % 60;
  return formatTimeOfDay(`${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`);
}

// Any Monday/Friday works as a stand-in date — getCourtBookingWindow only
// cares about day-of-week (weekday vs Fri/Sat), not the specific date.
// Resolving through the real window function (rather than reading
// courtCloseTimes directly) means this copy automatically reflects a
// court's "00:00 = no cutoff, defer to facility close" sentinel correctly
// instead of ever showing "12:00 AM" for it.
function nextWeekday(targetDay: number): Date {
  const result = new Date();
  result.setDate(result.getDate() + ((targetDay - result.getDay() + 7) % 7));
  return result;
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Cached at the DATA layer, not the route: this whole page reads
// searchParams (the availability grid's ?date= navigation), which forces
// the App Router to render the route fully dynamically on every
// request, full stop — confirmed directly, not assumed, by building for
// production and curling `/`: the response came back
// "Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate"
// even with a page-level `export const revalidate` set, identical to
// plain force-dynamic. A route-level revalidate is a silent no-op here.
// unstable_cache instead caches the RESULT of these three specific
// queries across separate incoming requests for 15s — a burst of many
// first-time visitors (a shared Facebook post, unlike the venue's own
// phones/kiosks polling /api/display) shares one set of DB reads instead
// of each triggering its own, even though every request still fully
// renders the page around that cached data. Scoped to exactly these
// three — NOT getOpenPlayOnlineRegistrationEnabled, which stays a live
// read every request, matching every other feature-switch check in this
// app (never cached, always fresh).
//
// UpcomingOpenPlayNight.date is a real Date; unstable_cache's own
// serialization behavior for non-JSON types isn't something to rely on
// either way, so it's converted to an ISO string going in and
// reconstructed as a real Date coming back out, on the caller's side —
// robust regardless of what the cache does internally.
const getCachedOpenPlayHomepageData = unstable_cache(
  async () => {
    const [upcomingOpenPlayNights, openPlayCapacityDefaults, openPlaySettings] = await Promise.all([
      openPlayCapacityService.getUpcomingNights(14),
      openPlayCapacityService.getCapacityDefaults(),
      settingsService.getOpenPlaySettings(),
    ]);
    return {
      upcomingOpenPlayNights: upcomingOpenPlayNights.map((night) => ({
        ...night,
        date: night.date.toISOString(),
      })),
      openPlayCapacityDefaults,
      openPlaySettings,
    };
  },
  ["homepage-open-play-cards"],
  { revalidate: 15 },
);

type OpenPlayCardState =
  | { kind: "not-open" }
  | { kind: "blocked" }
  | { kind: "not-yet-open"; opensAt: Date }
  | { kind: "full" }
  | { kind: "open"; remaining: number };

// Same three gates and the same lead-time math as
// createPublicOpenPlayRegistration (services/open-play/public-open-play-
// registration.service.ts) — duplicated, not imported, since that
// function's job is deciding whether a specific SUBMITTED registration
// is allowed, not computing display state for a card nobody's
// interacted with yet. Kept in the same order deliberately so this can
// never show "N spots left" for a date the actual registration attempt
// would then reject.
//
// registeredCount already counts a live AWAITING_PAYMENT hold as
// occupied (see getUpcomingNights' own comment: same predicate as
// countOccupiedSeats) — a held-but-unpaid seat isn't available, and
// showing it as free would let someone register straight into "session
// full." The tradeoff, deliberately not hidden: this number can go UP
// when a hold expires between two page loads, same as it goes down when
// someone new registers — it's a live count, not a monotonic one.
function computeOpenPlayCardState(
  night: UpcomingOpenPlayNight | undefined,
  dayEnabled: boolean,
  featureEnabled: boolean,
  leadTimeDays: number,
): OpenPlayCardState {
  if (!featureEnabled || !dayEnabled || !night) {
    return { kind: "not-open" };
  }
  if (night.onlineRegistrationBlocked) {
    return { kind: "blocked" };
  }

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const daysUntil = Math.round((night.date.getTime() - todayMidnight.getTime()) / (24 * 60 * 60 * 1000));
  if (daysUntil > leadTimeDays) {
    return { kind: "not-yet-open", opensAt: new Date(night.date.getTime() - leadTimeDays * 24 * 60 * 60 * 1000) };
  }

  const remaining = Math.max(0, night.capacity - night.registeredCount);
  if (remaining === 0) {
    return { kind: "full" };
  }
  return { kind: "open", remaining };
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const [
    { date: dateParam },
    hero,
    galleryImages,
    announcements,
    courtHours,
    paddleRentalCents,
    businessInfo,
    openPlayFeatureEnabled,
    cachedOpenPlayData,
  ] = await Promise.all([
    searchParams,
    settingsService.getHomepageHero(),
    settingsService.getGalleryImages(),
    announcementService.listPublished(),
    settingsService.getCourtHours(),
    equipmentService.getRentalRateCentsByKey(EQUIPMENT_KEYS.HOUSE_PADDLE),
    settingsService.getBusinessInfo(),
    settingsService.getOpenPlayOnlineRegistrationEnabled(),
    getCachedOpenPlayHomepageData(),
  ]);
  const upcomingOpenPlayNights = cachedOpenPlayData.upcomingOpenPlayNights.map((night) => ({
    ...night,
    date: new Date(night.date),
  }));
  const { openPlayCapacityDefaults, openPlaySettings } = cachedOpenPlayData;
  const latestAnnouncement = announcements[0];
  const date = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  const mondayForCopy = nextWeekday(1);
  const fridayForCopy = nextWeekday(5);
  const saturdayForCopy = nextWeekday(6);
  const court1Close = formatMinutesOfDay(getCourtBookingWindow(courtHours, "Court 1", mondayForCopy).closeMinutes);
  const court2Close = formatMinutesOfDay(getCourtBookingWindow(courtHours, "Court 2", mondayForCopy).closeMinutes);
  const court3Close = formatMinutesOfDay(getCourtBookingWindow(courtHours, "Court 3", mondayForCopy).closeMinutes);
  const fridaySaturdayClose = formatMinutesOfDay(
    getCourtBookingWindow(courtHours, "Court 1", fridayForCopy).closeMinutes,
  );

  const fridayDateValue = toLocalDateValue(fridayForCopy);
  const saturdayDateValue = toLocalDateValue(saturdayForCopy);
  const fridayNight = upcomingOpenPlayNights.find((night) => toLocalDateValue(night.date) === fridayDateValue);
  const saturdayNight = upcomingOpenPlayNights.find((night) => toLocalDateValue(night.date) === saturdayDateValue);
  const fridayDayEnabled = openPlayCapacityDefaults.find((row) => row.dayOfWeek === 5)?.onlineRegistrationEnabled ?? false;
  const saturdayDayEnabled = openPlayCapacityDefaults.find((row) => row.dayOfWeek === 6)?.onlineRegistrationEnabled ?? false;
  const fridayCardState = computeOpenPlayCardState(
    fridayNight,
    fridayDayEnabled,
    openPlayFeatureEnabled,
    openPlaySettings.onlineRegistrationLeadTimeDays,
  );
  const saturdayCardState = computeOpenPlayCardState(
    saturdayNight,
    saturdayDayEnabled,
    openPlayFeatureEnabled,
    openPlaySettings.onlineRegistrationLeadTimeDays,
  );
  const openPlayOpensAtFormatter = new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric" });

  function openPlayCardCopy(state: OpenPlayCardState): string {
    switch (state.kind) {
      case "full":
        return "Fully booked — join the waitlist and we'll text you if a spot opens up.";
      case "not-yet-open":
        return `Online registration opens ${openPlayOpensAtFormatter.format(state.opensAt)}.`;
      case "blocked":
        return "Online registration is closed for this date — contact us directly.";
      case "not-open":
        return "Register at the front desk, or ask about online registration.";
      case "open":
        return `${state.remaining} spot${state.remaining === 1 ? "" : "s"} left — register online, pay by GCash.`;
    }
  }

  return (
    <div className="bg-navy-900 flex min-h-svh flex-1 flex-col">
      <SiteHeader />

      {/* ============================ HERO ============================ */}
      <section className="relative overflow-hidden px-6 pt-[clamp(48px,7vw,84px)] pb-[clamp(36px,5vw,56px)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          style={{
            backgroundImage:
              "linear-gradient(180deg,transparent 55%,var(--navy-900) 100%), repeating-linear-gradient(90deg,transparent 0 118px,var(--line) 118px 119px)",
          }}
        />
        <div className="relative mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-x-12 gap-y-9 lg:grid-cols-[2fr_1fr]">
            {/* LEFT: hero copy, CTAs, Find Us */}
            <div>
              <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
                Indoor courts · Everyone welcome
              </span>
              <h1 className="font-display text-bone mt-4 text-[clamp(52px,14.8vw,176px)] leading-[0.86] font-black tracking-[-0.022em] text-balance uppercase">
                {hero.title}
              </h1>
              {hero.subtitle ? (
                <p className="text-slate mt-4 max-w-[44ch] text-[clamp(15px,1.5vw,17px)] text-balance">
                  {hero.subtitle}
                </p>
              ) : null}
              {latestAnnouncement ? (
                <p className="border-warning/40 bg-warning/10 text-bone mt-4 max-w-[52ch] rounded-lg border px-3 py-2 text-sm">
                  <span className="font-semibold">{latestAnnouncement.title}</span> — {latestAnnouncement.body}
                </p>
              ) : null}

              <div className="mt-7 flex flex-wrap gap-3">
                <Link href="#docket" className={`${PILL_BUTTON} bg-green text-navy-900 hover:-translate-y-px`}>
                  {hero.ctaText}
                </Link>
                <Link
                  href="/open-play/register"
                  className={`${PILL_BUTTON} border-line text-bone hover:border-green border font-semibold`}
                >
                  Join open play
                </Link>
                <Link
                  href="/phone"
                  className={`${PILL_BUTTON} border-line text-bone hover:border-green border font-semibold`}
                >
                  Who&apos;s playing now
                </Link>
              </div>

              {/* Find Us — lives in the hero, in the space the stats
                  block used to occupy, not as its own separate section
                  further down the page. */}
              {businessInfo.address || businessInfo.phone || businessInfo.mapsUrl ? (
                <div className="border-line mt-7 flex flex-wrap items-end justify-between gap-5 border-t pt-6">
                  <div>
                    <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
                      Come play
                    </span>
                    <h2 className="font-display text-bone mt-1.5 text-2xl leading-none font-extrabold tracking-[0.01em] uppercase">
                      Find us
                    </h2>
                    {businessInfo.address ? (
                      <p className="text-slate mt-2 max-w-[36ch] text-sm">{businessInfo.address}</p>
                    ) : null}
                    {businessInfo.phone ? (
                      <a
                        href={`tel:${businessInfo.phone}`}
                        className="text-bone hover:text-green mt-1 block text-sm font-semibold transition-colors"
                      >
                        {businessInfo.phone}
                      </a>
                    ) : null}
                  </div>
                  {businessInfo.mapsUrl ? (
                    <a
                      href={businessInfo.mapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className={`${PILL_BUTTON} bg-green text-navy-900 hover:-translate-y-px`}
                    >
                      Get directions
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* RIGHT: stats — moved here from underneath the hero copy,
                filling the space that used to sit empty beside it on
                wide screens. On mobile this simply stacks below the
                left column (hero text, then Find Us, then this). */}
            <div className="border-line flex flex-col gap-6 pt-1 lg:border-l lg:pl-10">
              <div className="max-w-[30ch]">
                <b className="font-display block text-[32px] leading-none font-extrabold tracking-[0.01em]">3</b>
                <span className="font-jetbrains text-slate text-[10px] tracking-[0.16em] uppercase">
                  Indoor courts
                </span>
                <p className="text-slate mt-1.5 text-[13px] leading-snug">
                  3 premium silica-coated courts — the same surface pros play on. Better grip, better bounce,
                  easier on your knees.
                </p>
              </div>
              <div className="border-line border-t pt-6">
                <b className="font-display block text-[32px] leading-none font-extrabold tracking-[0.01em]">
                  {formatTimeOfDay(courtHours.facilityOpenTime)}–{formatMinutesOfDay(getFacilityCloseMinutes(courtHours, date))}
                </b>
                <span className="font-jetbrains text-slate text-[10px] tracking-[0.16em] uppercase">
                  Open daily
                </span>
              </div>
              <div className="border-line border-t pt-6">
                <b className="font-display block text-[32px] leading-none font-extrabold tracking-[0.01em]">
                  All levels
                </b>
                <span className="font-jetbrains text-slate text-[10px] tracking-[0.16em] uppercase">
                  First-timers welcome
                </span>
              </div>
            </div>
          </div>

          {hero.imageUrl ? (
            <div className="border-line bg-navy-800 relative mt-9 aspect-[21/9] w-full overflow-hidden rounded-2xl border">
              <Image src={hero.imageUrl} alt={hero.title} fill className="object-cover" priority />
            </div>
          ) : null}
        </div>
      </section>

      {/* ============================ THE DOCKET ============================ */}
      <section id="docket" className="border-line border-t px-6 py-[clamp(40px,5vw,64px)]">
        <div className="mx-auto max-w-6xl">
          <CourtAvailabilityGrid date={date} />
        </div>
      </section>

      {/* ============================ SESSIONS ============================ */}
      <section id="sessions" className="border-line border-t px-6 py-[clamp(56px,7vw,90px)]">
        <div className="mx-auto max-w-6xl">
          <span className="font-jetbrains text-coral text-[11px] font-bold tracking-[0.22em] uppercase">
            No partner, no problem
          </span>
          <h2 className="font-display text-bone mt-2 text-[clamp(30px,4.4vw,52px)] leading-[0.94] font-extrabold tracking-[-0.01em] uppercase">
            Open play
          </h2>
          <p className="text-slate mt-3 max-w-[52ch] text-sm">
            Courts switch over to open play once their booking window closes. Show up on your own, and
            rotate in. Everyone&apos;s welcome — all levels, first-timers included.
          </p>

          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="border-line bg-navy-800 hover:border-green/45 rounded-2xl border p-6 transition-colors">
              <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                Sunday – Thursday
              </span>
              <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                Weeknight rotation
              </h3>
              <p className="text-slate mt-2 text-[14.5px]">
                Court 1 switches over at {court1Close}, Court 2 at {court2Close}, Court 3 at {court3Close}.
                Walk in, pay at the desk, no sign-up needed.
              </p>
              <span className="font-jetbrains text-green mt-4 block text-[13px] font-bold">₱35 / game</span>
            </div>
            <Link
              href={`/open-play/register?date=${fridayDateValue}`}
              className="border-line bg-navy-800 hover:border-green/45 rounded-2xl border p-6 transition-colors"
            >
              <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                Friday · from {fridaySaturdayClose}
              </span>
              <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                Friday unlimited
              </h3>
              <p className="text-slate mt-2 text-[14.5px]">
                All three courts go to open play at {fridaySaturdayClose}. {openPlayCardCopy(fridayCardState)}
              </p>
              <span className="font-jetbrains text-green mt-4 block text-[13px] font-bold">₱150 unlimited</span>
            </Link>
            <Link
              href={`/open-play/register?date=${saturdayDateValue}`}
              className="border-line bg-navy-800 hover:border-green/45 rounded-2xl border p-6 transition-colors"
            >
              <span className="font-jetbrains text-coral text-[10px] tracking-[0.18em] uppercase">
                Saturday · from {fridaySaturdayClose}
              </span>
              <h3 className="font-display mt-2 text-2xl font-extrabold tracking-[0.01em] uppercase">
                Saturday unlimited
              </h3>
              <p className="text-slate mt-2 text-[14.5px]">
                Same as Friday, bigger crowd. {openPlayCardCopy(saturdayCardState)}
              </p>
              <span className="font-jetbrains text-green mt-4 block text-[13px] font-bold">₱150 unlimited</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ============================ RULES ============================ */}
      <section className="border-line border-t px-6 py-[clamp(56px,7vw,90px)]">
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-[clamp(28px,5vw,64px)] md:grid-cols-[0.85fr_1.15fr]">
          <div>
            <span className="font-jetbrains text-green text-[11px] font-bold tracking-[0.22em] uppercase">
              Order in the court
            </span>
            <h2 className="font-display text-bone mt-2 text-[clamp(30px,4.4vw,52px)] leading-[0.94] font-extrabold tracking-[-0.01em] uppercase">
              House rules
            </h2>
            <p className="text-slate mt-3 max-w-[52ch] text-sm">
              Short list. It keeps the courts fast and the surface in good shape.
            </p>
          </div>
          <div className="border-line divide-line grid divide-y overflow-hidden rounded-2xl border">
            {[
              {
                title: "Non-marking shoes only",
                body: "Court shoes or clean trainers. Dark-soled running shoes leave streaks we can't lift.",
              },
              {
                title: "Your hour ends on the hour",
                body: "Clear the court on time so the next booking starts clean. 15-minute grace before we release a no-show.",
              },
              { title: "Water only on court", body: "Everything else stays at the benches." },
              {
                title:
                  paddleRentalCents != null
                    ? `Paddle rentals — ${formatCurrency(paddleRentalCents)} each`
                    : "Paddle rentals available",
                body: "Ask at the desk before you head on court. Bring your own and there's nothing to pay.",
              },
            ].map((rule, index) => (
              <div key={rule.title} className="bg-navy-800 flex gap-4 px-6 py-5">
                <span className="font-jetbrains text-green pt-0.5 text-[11px] font-bold">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <b className="text-bone block font-semibold">{rule.title}</b>
                  <p className="text-slate mt-0.5 text-sm">{rule.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {galleryImages.length > 0 ? (
        <section className="border-line border-t px-6 py-16">
          <div className="mx-auto max-w-6xl">
            <h2 className="font-display text-bone mb-6 text-2xl font-extrabold tracking-[-0.01em] uppercase">
              Gallery
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {galleryImages.slice(0, 8).map((image) => (
                <div key={image.url} className="border-line relative aspect-square overflow-hidden rounded-xl border">
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
