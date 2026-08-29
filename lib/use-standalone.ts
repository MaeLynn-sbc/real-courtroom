"use client";

import { useEffect, useState } from "react";

// True when the page is running as an installed PWA rather than in a
// browser tab.
//
// Exists for one specific problem: a same-origin link with
// target="_blank" opens a NEW SAFARI WINDOW when tapped inside an iOS
// standalone app, dumping the customer out of the app with no way back
// except the home screen. In an ordinary browser that same attribute is
// useful — it is what stops a half-filled booking form being lost — so
// the fix is to drop the attribute only where it does harm, not
// everywhere.
//
// Always false on the server and on first paint, then corrected in an
// effect. That ordering is deliberate: reading matchMedia during render
// would desync server and client HTML on pages that are server-rendered.
// The one-frame cost is a link that briefly carries target="_blank"
// before the effect runs, which nobody can tap in time.
export function useIsStandalone(): boolean {
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // matchMedia is absent in jsdom and in some older embedded webviews.
    // Falling back to the iOS-only `standalone` flag keeps the hook
    // useful there, and a plain `false` is the right answer anywhere
    // neither exists — a browser that cannot report standalone mode is
    // not running one.
    if (typeof window.matchMedia !== "function") {
      setIsStandalone(
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );
      return;
    }

    const query = window.matchMedia("(display-mode: standalone)");
    const check = () =>
      setIsStandalone(
        query.matches ||
          // Older iOS predates display-mode and only exposes this
          // non-standard flag, which is still what many installed
          // iPhones report.
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      );

    check();
    query.addEventListener("change", check);
    return () => query.removeEventListener("change", check);
  }, []);

  return isStandalone;
}
