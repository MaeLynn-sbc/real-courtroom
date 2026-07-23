import Link from "next/link";

import { siteConfig } from "@/lib/config";
import { settingsService } from "@/services/settings/settings.service";

const NAV_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/courts", label: "Courts" },
  { href: "/rates", label: "Rates" },
  { href: "/open-play", label: "Open Play" },
  { href: "/contact", label: "Contact" },
  { href: "/book", label: "Book Now" },
];

export async function SiteFooter() {
  const businessInfo = await settingsService.getBusinessInfo();

  return (
    <footer className="border-border/60 border-t">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-10 sm:grid-cols-3">
        <div className="flex flex-col gap-2 text-sm">
          <p className="font-heading text-foreground font-semibold">{businessInfo.name || siteConfig.name}</p>
          {businessInfo.address ? <p className="text-muted-foreground">{businessInfo.address}</p> : null}
          {businessInfo.hours ? <p className="text-muted-foreground">{businessInfo.hours}</p> : null}
        </div>

        <nav className="flex flex-col gap-2 text-sm">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground text-muted-foreground">
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-col gap-2 text-sm">
          {businessInfo.phone ? <p className="text-muted-foreground">{businessInfo.phone}</p> : null}
          {businessInfo.email ? <p className="text-muted-foreground">{businessInfo.email}</p> : null}
          {businessInfo.facebookUrl ? (
            <a
              href={businessInfo.facebookUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground text-muted-foreground"
            >
              Facebook
            </a>
          ) : null}
          {businessInfo.mapsUrl ? (
            <a
              href={businessInfo.mapsUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:text-foreground text-muted-foreground"
            >
              Get directions
            </a>
          ) : null}
        </div>
      </div>

      <div className="border-border/60 text-muted-foreground mx-auto max-w-6xl border-t px-6 py-4 text-xs">
        © {new Date().getFullYear()} {businessInfo.name || siteConfig.name}. All rights reserved.
      </div>
    </footer>
  );
}
