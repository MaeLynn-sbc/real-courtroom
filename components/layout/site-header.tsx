import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { SiteHeaderMobileMenu } from "@/components/layout/site-header-mobile-menu";
import { SiteStatusPill } from "@/components/layout/site-status-pill";
import { PUBLIC_VISIBILITY_KEYS } from "@/lib/public-visibility";
import { cn } from "@/lib/utils";
import { settingsService } from "@/services/settings/settings.service";

const BASE_NAV_LINKS: { href: string; label: string }[] = [
  { href: "/about", label: "About" },
  { href: "/courts", label: "Courts" },
  // Reported live: coaching was only discoverable after already booking a
  // court (the post-booking add-on step) — most customers never saw it
  // existed at all. Index 2, matching the OPEN_PLAY conditional insertion
  // logic below (slice(0,2) / slice(2)) — Open Play lands right before
  // this, both "core activity" links ahead of Rates/Contact. Points at
  // the coaching info page (who the coaches are, rates, how it works),
  // not straight at the availability schedule — that page links onward
  // to /coaches/availability itself, so this is the one link a customer
  // actually needs from the header.
  { href: "/coaches", label: "Coaches" },
  { href: "/rates", label: "Rates" },
  { href: "/contact", label: "Contact" },
];

const PILL_BUTTON =
  "inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green";
const PILL_BUTTON_PRIMARY = cn(
  PILL_BUTTON,
  "bg-green text-navy-900 hover:-translate-y-px hover:shadow-[0_8px_24px_rgba(143,194,79,.25)]",
);
const PILL_BUTTON_GHOST = cn(PILL_BUTTON, "border-line text-bone hover:border-green border font-semibold");

export async function SiteHeader() {
  const visibility = await settingsService.getPublicVisibility();

  // Gate 3: repointed from /open-play (the old, unrelated OpenPlaySession
  // list) to the real self-registration form, now that one exists — was
  // deliberately left alone through Gates 1/2 since there was nothing to
  // point it at yet. The old page is untouched and still reachable by
  // direct URL, just no longer the thing this nav link claims to be.
  const navLinks = visibility[PUBLIC_VISIBILITY_KEYS.OPEN_PLAY]
    ? [...BASE_NAV_LINKS.slice(0, 2), { href: "/open-play/register", label: "Open Play" }, ...BASE_NAV_LINKS.slice(2)]
    : BASE_NAV_LINKS;

  return (
    <header className="bg-navy-900/85 border-line sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-7 px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5">
          <Logo size="sm" />
          <span className="font-display text-bone text-[19px] leading-none font-black tracking-[0.03em] uppercase">
            The <span className="text-green">Courtroom</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-6 text-sm font-semibold md:flex">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="text-slate hover:text-bone transition-colors">
              {link.label}
            </Link>
          ))}
        </nav>

        <SiteStatusPill />

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/lookup" className="text-slate hover:text-bone hidden text-sm font-semibold sm:inline">
            Find my booking
          </Link>
          <Link href="/book" className={PILL_BUTTON_PRIMARY}>
            Book now
          </Link>
          <Link href="/login" className={cn(PILL_BUTTON_GHOST, "hidden md:inline-flex")}>
            Sign in
          </Link>
          <SiteHeaderMobileMenu navLinks={navLinks} />
        </div>
      </div>
    </header>
  );
}
