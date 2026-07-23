import Link from "next/link";

import { Logo } from "@/components/shared/logo";
import { buttonVariants } from "@/components/ui/button";
import { PUBLIC_VISIBILITY_KEYS } from "@/lib/public-visibility";
import { settingsService } from "@/services/settings/settings.service";

const BASE_NAV_LINKS: { href: string; label: string }[] = [
  { href: "/about", label: "About" },
  { href: "/courts", label: "Courts" },
  { href: "/rates", label: "Rates" },
  { href: "/contact", label: "Contact" },
];

export async function SiteHeader() {
  const visibility = await settingsService.getPublicVisibility();

  const navLinks = visibility[PUBLIC_VISIBILITY_KEYS.OPEN_PLAY]
    ? [...BASE_NAV_LINKS.slice(0, 2), { href: "/open-play", label: "Open Play" }, ...BASE_NAV_LINKS.slice(2)]
    : BASE_NAV_LINKS;

  return (
    <header className="border-border/60 bg-background/80 sticky top-0 z-40 border-b backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
        <Link href="/" className="flex shrink-0 items-center">
          <Logo size="sm" showWordmark />
        </Link>

        <nav className="hidden items-center gap-6 text-sm font-medium md:flex">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground text-muted-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link href="/lookup" className="hover:text-foreground text-muted-foreground hidden text-sm sm:inline">
            Find my booking
          </Link>
          <Link href="/book" className={buttonVariants({ size: "sm" })}>
            Book Now
          </Link>
          <Link href="/login" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </div>
    </header>
  );
}
