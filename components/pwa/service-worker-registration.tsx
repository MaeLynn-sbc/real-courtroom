"use client";

import { useEffect } from "react";

// Registers public/sw.js. Renders nothing.
//
// Mounted in the ROOT layout, so the worker's scope is "/" and it
// therefore also controls /dashboard. That is unavoidable — the pages
// meant to be installable live at the root — and it is harmless here
// only because the worker caches nothing and intercepts no responses.
// If sw.js ever starts caching, this becomes a staff-facing problem too.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    // Registered after load rather than during render: registration
    // competes with the initial page for bandwidth, and nothing on the
    // first paint depends on the worker existing.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Deliberately silent. A failed registration costs an Android
        // install prompt and nothing else — every page still works. It
        // must never surface an error to a customer mid-booking.
      });
    };

    if (document.readyState === "complete") {
      register();
      return;
    }

    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
