# Troubleshooting

Known issue categories, drawn from the gotchas documented across every
phase's addendum in [ARCHITECTURE.md](../ARCHITECTURE.md). If something is
broken and it isn't listed here, check that file's addenda — the specific
gotcha number is cited next to each entry below in case you need the full
original write-up.

## The app runs, but behaves as if a code change didn't happen

**Symptom**: you changed `prisma/schema.prisma`, regenerated the client,
but the app still behaves like the old schema — or `prisma.someModel` is
`undefined` at runtime despite typechecking fine.

**Cause**: `lib/prisma.ts` caches the `PrismaClient` instance on
`globalThis` in development (intentional — survives Next.js Fast Refresh
without exhausting DB connections). An already-running dev server keeps
using the client instance from when it started; regenerating the client on
disk doesn't reach into a running process. (Phase 4 gotcha #7, Phase 3
gotcha #4.)

**Fix**: fully restart `npm run dev` (stop the process, start it again —
not just save-triggered hot reload) after any schema change +
`prisma generate`. If the model delegate is still `undefined` after a
restart, delete and regenerate from scratch:
```
rm -rf lib/generated/prisma
npm run db:generate
```

## Login redirects everyone to /unauthorized

**Cause**: usually the same stale-dev-server issue above, or a permission
grant added to `prisma/seed.ts`'s `ROLE_PERMISSION_GRANTS` that hasn't been
re-applied yet — a database permission change only exists once `npm run
db:seed` is re-run. (Phase 4 gotcha #8.)

**Fix**: re-run `npm run db:seed`, then have the affected user sign out and
back in (permissions are embedded in the session JWT at login, not
re-checked live — see [DEVELOPER_ONBOARDING.md](./DEVELOPER_ONBOARDING.md)).

## `next dev` fails with `ENOENT ... vendor-chunks/...`

**Cause**: `.next`'s cache gets corrupted when `next build` (production)
and `next dev` are run against the same `.next` directory in sequence.

**Fix**: `rm -rf .next` before restarting `npm run dev`.

## Playwright suite: individual specs pass, but fail when run all together

This is a real, long-documented category — not a sign the app itself is
broken. Confirmed, repeatedly, across phases: every affected spec passes
reliably when run alone; the failures only appear under the combined
load of the full suite on a single worker.

**Two contributing causes, both real:**

1. `next dev`'s on-demand route compilation can abort an in-flight request
   when several mutating actions fire in quick succession against a route
   that hasn't finished its first compile (Phase 4 gotcha #9, Phase 5
   gotcha #10, Phase 6 gotcha #12).
2. A server action's `router.refresh()` can genuinely take longer than the
   default assertion timeout to land under combined system load — the
   mutation itself always succeeds (confirmed by checking the database
   directly), it's the UI re-render that lags. This is **not** specific to
   dev-mode compilation: measured directly in Phase 10, the same failure
   category showed up running against a production build
   (`next build && next start`) too, just slightly less often (Phase 10
   gotcha #26).

**What's already in place to absorb this**: `playwright.config.ts` runs
with `workers: 1` and `retries: 1` locally (`2` in CI) specifically for
this reason. If you see a failure in a full-suite run, **re-run just that
one spec in isolation** before assuming it's a real regression:
```
npx playwright test e2e/the-failing-spec.spec.ts
```
If it passes alone, it's this category. If it fails alone too, it's a real
bug — investigate normally.

**Set `PW_PROD_SERVER=1`** to run against a production build instead of
dev mode — it narrows the failure surface (removes the compile-time
variance) but does not eliminate the need for retries; don't disable
retries for a prod-server run.

## Playwright suite: a spec that used to pass now fails only on a second run

**Cause**: the spec creates test data with a fixed relative
time/date/resource (e.g. "tomorrow at 10am" on a hardcoded court) instead
of a genuinely unique-per-run value, and collides with the still-present
row its own previous run left behind in a long-lived, never-reset dev
database. Confirmed twice: a booking test using a fixed `tomorrow` date
(Phase 9 gotcha #23), and — recurring, because the rule wasn't retroactively
applied — a walk-in booking test with no way to vary "now", and a court-name
assertion that wasn't `exact: true` and coincidentally matched a leftover
row from an earlier run of the same spec (Phase 10 gotcha #25).

**Fix**: vary the date/time/resource per run (a `Date.now()`-derived
offset, same as every other spec's guest-name/reference-code pattern
already does), and use `exact: true` on any locator matching a short,
guessable string that a stray previous-run row could coincidentally
contain as a substring.

**Longer-term mitigation**: periodically reset the local/CI dev database
(re-seed from scratch) to clear accumulated test-data debris — a
sufficiently long-lived dev database will always eventually surface this
category again for any spec that doesn't self-clean.

## A Base UI component silently does nothing on click (no error shown)

**Cause**: confirmed once as a real bug in a shared component
(`components/ui/dropdown-menu.tsx`'s `DropdownMenuLabel` — Base UI's
`Menu.GroupLabel` throws unless wrapped in `Menu.Group`, and the throw was
swallowed by Next's dev error boundary, so the only visible symptom was
`aria-expanded` never flipping to `true`) (Phase 9 gotcha #19).

**Fix**: before assuming the calling code is wrong, open the browser
console directly (or script a `page.on("pageerror", ...)` listener in
Playwright) — a swallowed client exception inside a shared UI wrapper
won't always surface as a normal thrown-and-caught test failure.

## An e2e assertion is ambiguous / matches more than one element

**Cause**: this app reuses short, generic words in multiple places on the
same page on purpose (a status badge and a form field can both say
"Available"; a KPI card and a nav link can both say "Bookings"; an entity
name can appear in both a summary table and a detail table) (Phase 6
gotcha #13, Phase 8 gotchas #16/#18, Phase 9 gotcha #21).

**Fix**: scope the locator — `.first()` (verified DOM-order-stable), a
specific `data-slot="card"`/table container, or `page.getByRole("main")` —
rather than treating the ambiguity as an app bug.

## Determining which side of a race "won" in a concurrency e2e test

**Cause**: a one-shot `.isVisible()` or `page.url()` check taken right
after `waitForLoadState("networkidle")` can run before the mutation's
resulting React state has actually committed — `networkidle` only
guarantees the network request settled (Phase 10 gotcha #27).

**Fix**: poll for the actual outcome instead of reading it once — see
`e2e/concurrency.spec.ts`'s `determineOutcome` helper for the pattern
(poll both the "win" and "lose" signal in the same loop; never chain two
sequential bounded waits, since their timeouts can sum past Playwright's
per-test timeout).

## Rate limiting seems to be blocking a legitimate user

**Cause 1**: repeated failed login attempts for the same email within the
window (10 attempts / 5 minutes by default) — this is the intended
behavior. Ask the user to wait, or double-check their password is correct.

**Cause 2** (fixed in Phase 10, listed here in case a similar bug recurs
elsewhere): the rate limiter must only count *failed* attempts toward a
brute-force-protection quota — a version that counted every attempt,
including successes, would eventually block a legitimate user who simply
logs in often (Phase 10 gotcha #24). If you add a new rate limit, decide
explicitly whether it's brute-force protection (failures only,
`peekRateLimit` + `recordRateLimitFailure`) or resource-consumption
protection (every attempt counts, `checkRateLimit`) — see
`lib/rate-limit.ts`.

**Cause 3**: rate limiting is per-process, in-memory — it does not work
correctly across multiple app instances behind a load balancer (see
[DEPLOYMENT.md](./DEPLOYMENT.md)'s single-instance-deployment note). If
you've scaled horizontally, this isn't a bug so much as a known
architectural limit that needs a shared store (Redis) to fix properly.

## Health check / diagnostics page reports the database as unreachable

Check `DATABASE_URL` first, then network/firewall rules between the app
and the database host. `GET /api/health` and `/dashboard/admin/diagnostics`
both surface the same underlying check (`services/health/health.service.ts`)
— a live `SELECT 1` against Postgres — so either one failing means the
same thing: the app process is up, but it cannot reach the database.
