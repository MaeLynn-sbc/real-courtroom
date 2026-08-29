import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, JetBrains_Mono, Manrope, Saira_Condensed } from "next/font/google";

import "./globals.css";

import { Toaster } from "@/components/ui/sonner";
import { QueryProvider } from "@/components/providers/query-provider";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AddToHomeScreenBanner } from "@/components/pwa/add-to-home-screen";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { siteConfig } from "@/lib/config";

// v1.1 Sub-phase 5: Manrope (headings) + Inter (body) replace Geist Sans.
// Geist Mono is untouched (still used for tabular-nums numeric displays).
// This also fixes a pre-existing bug — globals.css's --font-sans used to
// be self-referential and never actually resolved to the loaded Geist
// variable, so headings silently rendered in the browser default font
// despite Geist being downloaded. Both new variables are bound correctly
// in globals.css's @theme inline block.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// v1.2: the public-site design port (docs/design-reference.html) — Saira
// Condensed for display headings, JetBrains Mono for prices/times/eyebrow
// labels. Scoped to the public home page + shared header/footer via the
// font-display/font-jetbrains theme tokens (globals.css); the rest of the
// app (dashboard etc.) keeps Manrope/Inter/Geist Mono untouched.
const sairaCondensed = Saira_Condensed({
  variable: "--font-saira-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s — ${siteConfig.name}`,
  },
  description: siteConfig.description,
  icons: {
    icon: "/branding/favicon.png",
  },
  // PWA, iOS half (owner decision, 2026-08-29). Safari fires no
  // beforeinstallprompt and reads none of the manifest's display or
  // theme fields — these meta tags are the ONLY way it learns to launch
  // standalone rather than in a browser tab.
  appleWebApp: {
    capable: true,
    // What appears under the icon on the home screen. iOS truncates at
    // roughly 12 characters, so "The Courtroom" would render as
    // "The Courtr...". Matches the manifest's short_name.
    title: "Courtroom",
    // "black-translucent" would let the page run under the status bar,
    // which on a dark site reads as a rendering fault unless every page
    // handles the inset. "default" keeps the status bar its own solid
    // strip, which is correct for a site that is not full-bleed.
    statusBarStyle: "default",
  },
};

// Painted behind the status bar and browser chrome. Matches --navy-900
// in globals.css and the manifest's theme_color; a mismatch shows as a
// band of the wrong colour above the page.
export const viewport: Viewport = {
  themeColor: "#0e1424",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${inter.variable} ${geistMono.variable} ${sairaCondensed.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        {/* v1.1 Sub-phase 5: the dark navy system is the flagship brand
            look ("Dark Navy inspired by the court walls"), not an
            opt-in dark mode — defaultTheme is "dark" so that's what
            most visitors see by default. The toggle/next-themes
            infrastructure stays fully intact; light mode is a
            light-shell variant of the same brand palette, not removed. */}
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          <SessionProvider>
            <QueryProvider>
              {children}
              <Toaster />
              {/* PWA. The worker registers from the ROOT layout because
                  its scope must be "/" for the installable public pages
                  to be covered — which means it controls /dashboard too.
                  Harmless only because it caches nothing (see sw.js).

                  The install banner is NOT mounted here: it self-limits
                  to public pages, since staff on /dashboard are already
                  on a laptop or a shared counter tablet and have no use
                  for an iPhone home-screen prompt. */}
              <ServiceWorkerRegistration />
              <AddToHomeScreenBanner />
            </QueryProvider>
          </SessionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
