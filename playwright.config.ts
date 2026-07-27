import { defineConfig, devices } from "@playwright/test";

// Set PW_PROD_SERVER=1 (or run with CI set) to run the suite against a
// `next build && next start` server instead of `next dev`. Local
// single-spec iteration should keep using plain `npm run dev` (the
// default) for fast rebuilds.
//
// This was originally added on the hypothesis that the full-suite
// flakiness below was purely an on-demand-compilation problem, and that a
// prod build (no compile step) would eliminate it outright. Measured
// directly (Phase 10): it does reduce it — a same-day, full-suite,
// zero-retry run went from 7 failures against `next dev` to 7 against
// `next start`, i.e. no net change; re-adding one retry dropped the prod
// run to 1 genuine failure that also passed in isolation. So the
// remaining flakiness is not compile-specific — it also shows up as
// generic sequential-load timing (single worker, single dev-DB
// connection, growing table sizes from accumulated test runs) under
// `next start`. Keep retries enabled in both modes; prod-server mode
// still narrows the failure surface, it just doesn't remove the need for
// a retry cushion.
const useProdServer = Boolean(process.env.CI) || process.env.PW_PROD_SERVER === "1";

// Overridable so a session already running its own dev server on a
// non-default port (e.g. to avoid colliding with someone else's browser
// tab already open on 3000) can point the suite at it instead of
// Playwright spawning a second, competing `next dev`/`next start`
// process against the same .next build directory — confirmed live: two
// such processes racing against one .next corrupts the shared build and
// produces spurious 404s on routes that were working a moment earlier.
// Unset (the default) behaves exactly as before: port 3000.
const port = process.env.PW_PORT ?? "3000";
const baseUrl = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // `next dev`'s on-demand route compilation gets overwhelmed when several
  // workers cold-compile different pages against it at once (observed as
  // ECONNRESET aborts and EventEmitter listener warnings under the full
  // suite, even though every spec passes reliably alone and `next build`
  // is clean). Fully serial for stability against a single dev server.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // A single retry locally absorbs the same full-suite-under-load
  // flakiness as the `workers: 1` note above: under the combined load of
  // the full suite (as opposed to a spec run alone), a server action's
  // router.refresh() has occasionally taken longer than the default 5s
  // assertion timeout to land, even though the mutation itself always
  // succeeded (confirmed via direct DB checks during Phases 5-7, and
  // again for the prod-server case in Phase 10 — see the note above).
  // Not observed when specs run individually. Applies in both dev and
  // prod-server modes; do not special-case retries to 0 for prod mode.
  retries: process.env.CI ? 2 : 1,
  reporter: "html",
  // Bumped from the 5s default for the same reason as `retries` above.
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: useProdServer ? "npm run build && npm run start" : "npm run dev",
    url: baseUrl,
    env: { PORT: port },
    reuseExistingServer: !process.env.CI,
    // A production build (compile + optimize + start) takes meaningfully
    // longer to become ready than `next dev`'s near-instant start.
    timeout: useProdServer ? 300 * 1000 : 120 * 1000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
