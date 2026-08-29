// Minimal pass-through service worker. It exists for ONE reason: Chrome
// on Android will not offer "Install app" without a registered worker
// that has a fetch handler. iOS needs no worker at all — Safari installs
// from the manifest plus apple-touch-icon alone.
//
// IT DELIBERATELY CACHES NOTHING (owner decision, 2026-08-29).
//
// Almost everything this site shows is live and short-lived: court
// availability, open-play seat counts, the GCash QR, tournament
// brackets. A caching worker would serve yesterday's seat count to
// someone deciding whether to register, and the venue deploys several
// times a day, so a stale shell would outlive several releases. A
// cache here buys a little speed and costs correctness on exactly the
// numbers customers act on.
//
// If offline support is ever wanted, it should be added deliberately
// with a versioned cache and an explicit list of safe-to-cache assets —
// never by making this handler start storing responses.

self.addEventListener("install", () => {
  // Take over immediately rather than waiting for every tab to close.
  // Safe precisely BECAUSE nothing is cached: there is no old bundle to
  // conflict with, so a new worker cannot serve a stale mix.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Defensive: if a caching worker is ever shipped by mistake and
      // then reverted, this clears whatever it left behind on the next
      // activation instead of stranding it on customers' phones.
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Required for installability: Chrome checks that a fetch handler
// exists. Passing the request straight to the network keeps every
// response live and identical to a non-installed visit.
self.addEventListener("fetch", () => {
  // Intentionally does NOT call event.respondWith — the browser handles
  // the request normally. Registering the listener is what Chrome looks
  // for; intercepting the response is not required and is what would
  // introduce staleness.
});
