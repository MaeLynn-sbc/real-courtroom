import Link from "next/link";

import { Logo } from "@/components/shared/logo";
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

function FooterHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="font-jetbrains text-slate mb-3 text-[10.5px] font-medium tracking-[0.18em] uppercase">
      {children}
    </h4>
  );
}

export async function SiteFooter() {
  const businessInfo = await settingsService.getBusinessInfo();

  return (
    <footer className="bg-navy-900 border-line border-t">
      <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-10 px-6 py-14">
        <div className="flex max-w-[280px] flex-col gap-3">
          <Logo size="default" />
          <p className="text-slate text-sm">
            Indoor pickleball. Book a court, join a session, or just come watch. Everyone&apos;s welcome.
          </p>
        </div>

        <div>
          <FooterHeading>Visit</FooterHeading>
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="text-bone font-semibold">{businessInfo.name || siteConfig.name}</p>
            {businessInfo.address ? <p className="text-slate">{businessInfo.address}</p> : null}
          </div>
        </div>

        <div>
          <FooterHeading>Get in touch</FooterHeading>
          <div className="flex flex-col gap-1.5 text-sm">
            {businessInfo.phone ? (
              <a href={`tel:${businessInfo.phone}`} className="text-bone hover:text-green transition-colors">
                {businessInfo.phone}
              </a>
            ) : null}
            {businessInfo.email ? (
              <a href={`mailto:${businessInfo.email}`} className="text-bone hover:text-green transition-colors">
                {businessInfo.email}
              </a>
            ) : null}
            {businessInfo.facebookUrl ? (
              <a
                href={businessInfo.facebookUrl}
                target="_blank"
                rel="noreferrer"
                className="text-bone hover:text-green transition-colors"
              >
                Facebook
              </a>
            ) : null}
            {businessInfo.mapsUrl ? (
              <a
                href={businessInfo.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-bone hover:text-green transition-colors"
              >
                Get directions
              </a>
            ) : null}
          </div>
        </div>

        <div>
          <FooterHeading>Explore</FooterHeading>
          <nav className="flex flex-col gap-1.5 text-sm">
            {NAV_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-bone hover:text-green transition-colors">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        {businessInfo.hours ? (
          <div>
            <FooterHeading>Hours</FooterHeading>
            <p className="text-bone text-sm">{businessInfo.hours}</p>
          </div>
        ) : null}
      </div>

      <div className="border-line font-jetbrains text-slate mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t px-6 py-5 text-[11px]">
        <span>
          © {new Date().getFullYear()} {businessInfo.name || siteConfig.name}
        </span>
        <span>Order in the court.</span>
      </div>
    </footer>
  );
}
