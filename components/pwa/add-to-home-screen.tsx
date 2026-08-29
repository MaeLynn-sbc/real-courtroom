"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

const DISMISSED_KEY = "tcpms.a2hs.dismissed";

// iOS Safari fires no beforeinstallprompt and shows no install UI of its
// own, so an iPhone visitor has no way to discover this is installable.
// Android does have a native prompt, which is why this banner is shown
// ONLY on iOS — duplicating Chrome's own prompt would be noise.
//
// Hidden once installed: display-mode:standalone (and navigator.standalone
// on older iOS) means they already did this.
function useShouldOfferInstall(): boolean {
  const [shouldOffer, setShouldOffer] = useState(false);

  useEffect(() => {
    // Runs in an effect, never during render: every check below reads
    // browser-only state, and doing it at render time would produce a
    // server/client hydration mismatch on a page that is otherwise
    // server-rendered.
    const ua = window.navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua);
    // iPadOS 13+ reports itself as a Mac; the touch check separates a
    // real iPad from a desktop Safari where this banner is pointless.
    const isIPadOS = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;

    // Chrome/Firefox/Edge on iOS cannot add to the home screen at all —
    // only Safari can. Showing them these instructions would send people
    // hunting for a Share option that will not work.
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);

    const alreadyInstalled =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === "1";
    } catch {
      // Private browsing can throw on localStorage access. Treat that as
      // "not dismissed" and show the banner — an extra prompt is a much
      // smaller failure than a crash on a public booking page.
    }

    setShouldOffer((isIOS || isIPadOS) && isSafari && !alreadyInstalled && !dismissed);
  }, []);

  return shouldOffer;
}

export function AddToHomeScreenBanner() {
  const shouldOffer = useShouldOfferInstall();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(false);

  // Public pages only. It mounts in the root layout (the only place that
  // wraps every public route), so staff areas are excluded here rather
  // than by where it is mounted. Nobody on the dashboard is installing
  // this to an iPhone home screen.
  const isStaffArea = pathname.startsWith("/dashboard") || pathname.startsWith("/login");
  // The TV/kiosk surfaces are unattended displays — a dismissible banner
  // would sit there forever with nobody to dismiss it.
  const isKiosk =
    pathname.startsWith("/tv") ||
    pathname.startsWith("/tourtv") ||
    pathname.startsWith("/display") ||
    pathname.startsWith("/phone");

  if (!shouldOffer || hidden || isStaffArea || isKiosk) {
    return null;
  }

  const dismiss = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Dismissal not persisting is acceptable; the banner reappearing
      // next visit is better than an unhandled exception here.
    }
  };

  return (
    <div
      // Above the fold would interrupt someone mid-booking. Pinned to the
      // bottom, it stays available without ever covering a form field.
      className="border-line bg-navy-900/95 fixed inset-x-0 bottom-0 z-50 border-t px-4 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      role="complementary"
      aria-label="Install this site"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <p className="text-bone flex-1 text-sm leading-snug">
          <span className="font-semibold">Add The Courtroom to your home screen.</span>{" "}
          <span className="text-bone/70">
            Tap Share, then &ldquo;Add to Home Screen&rdquo;.
          </span>
        </p>
        <Button variant="ghost" size="sm" onClick={dismiss} className="shrink-0">
          Not now
        </Button>
      </div>
    </div>
  );
}

// The same instructions as a permanent, non-dismissible block. Staff walk
// customers through this at the counter, so it has to be findable on
// demand rather than only appearing in a banner someone already
// dismissed — and it must render for everyone, including the Android and
// desktop visitors the banner deliberately skips.
export function AddToHomeScreenInstructions() {
  return (
    <div className="border-line rounded-lg border p-4">
      <h3 className="text-bone text-sm font-bold">Add to your home screen</h3>
      <ol className="text-bone/70 mt-2 list-decimal space-y-1 pl-4 text-sm">
        <li>Open this site in Safari.</li>
        <li>
          Tap the Share button — the square with an arrow pointing up, at the bottom of the
          screen.
        </li>
        <li>
          Scroll down and tap <span className="text-bone font-medium">Add to Home Screen</span>.
        </li>
        <li>
          Tap <span className="text-bone font-medium">Add</span>. The Courtroom will appear with
          your other apps.
        </li>
      </ol>
      <p className="text-bone/50 mt-3 text-xs">
        On Android, open the browser menu and choose Install app.
      </p>
    </div>
  );
}
