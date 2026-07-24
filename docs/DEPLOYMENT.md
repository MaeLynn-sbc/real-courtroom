# Deployment Guide

TCPMS is a single Next.js application backed by one PostgreSQL database.
This guide covers what "production-ready" means for this specific app —
read [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) and
[BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md) alongside it.

## Known limitation: single-instance deployment

Two pieces of infrastructure are intentionally in-memory, `globalThis`-cached
implementations, not distributed:

- **Rate limiting** (`lib/rate-limit.ts`) — login attempts and CSV export
  throttling are tracked per-process. A horizontally-scaled deployment
  (multiple Next.js instances/containers behind a load balancer) would let
  an attacker or heavy user bypass the limit by landing on a different
  instance. If you scale beyond one instance, replace `lib/rate-limit.ts`'s
  store with Redis (or similar) before relying on the limits.
- **Nothing else in the app depends on in-process state** — sessions are
  JWT-based (stateless), and all persisted data goes through Postgres.

For a single-instance deployment (one container/VM running `next start`),
no changes are needed.

## Environment variables

Validated at startup by `lib/env.ts` — the app hard-exits (not a thrown
exception — see "Boot failures" below) immediately on an invalid or
missing required variable rather than failing later.

| Variable | Required | Secret? | Notes |
|---|---|---|---|
| `NODE_ENV` | Yes (usually set by the platform) | No | `production` in prod. Also gates the seed guard and the integration-test guard below. |
| `TZ` | Yes | No | Must resolve to UTC+8, no DST (`Asia/Manila`). The app hard-fails at boot if it doesn't — see "Boot failures" below. Set in the Dockerfile already; only relevant if deploying without that image. |
| `DATABASE_URL` | Yes | **Yes** | Postgres connection string — contains the database password. Never log it, never put it in a build log or CI output. |
| `AUTH_SECRET` | Yes | **Yes** | Generate with `npx auth secret`. Rotating it invalidates every existing session. |
| `AUTH_URL` | Recommended | No | The app's public URL (e.g. `https://courtroom.example.com`). Auth.js infers it otherwise, but setting it explicitly avoids surprises behind a proxy. |
| `FEATURE_OPEN_PLAY` | Effectively required for this venue | No | `"true"`/`"false"`. The only feature flag with a real effect today — gates `/dashboard/open-play` entirely (`app/dashboard/open-play/page.tsx`). Open Play is this venue's core Fri/Sat business — set `"true"` in production. |
| `FEATURE_PAYMENTS` / `FEATURE_TOURNAMENTS` / `FEATURE_MEMBERSHIPS` / `FEATURE_EQUIPMENT_RENTALS` | No | No | Defined (`lib/feature-flags.ts`) but not yet checked anywhere — reserved for future modules. Value doesn't currently matter. |
| `PAYMENT_PROVIDER` | No | No | Only `"local"` exists today. |
| `EMAIL_PROVIDER` | No | No | Only `"console"` exists today — no real email is sent in this version of the app. |
| `UPLOAD_PROVIDER` | No | No | Only `"local"` exists today. |
| `LOG_LEVEL` | No | No | One of `fatal/error/warn/info/debug/trace`. Use `info` or `warn` in production; `debug`/`trace` are verbose. |
| `ALLOW_PROD_SEED` | No | No (but gates a secret-adjacent action) | Must be `"true"` to run `npm run db:seed` when `NODE_ENV=production`. See "Bootstrap: the first Owner account" below. |

Copy `.env.example` as a starting point and fill in real values — never
commit a real `.env`. `.env.example` does not list `AUTH_GOOGLE_ID` /
`AUTH_GOOGLE_SECRET` / `FEATURE_GOOGLE_LOGIN` — Google login isn't
implemented in this version of the app (checked: no reference anywhere
in the codebase); don't configure them.

## Boot failures — what they look like, and why that matters

Two things can stop the app from starting at all, both validated in
`lib/env.ts` before anything else runs: invalid/missing required env
vars, and a process timezone that isn't UTC+8/no-DST. Both are a clean,
single-line `console.error` followed by `process.exit(1)` — not a thrown
exception, so container boot logs show exactly one legible line, not a
Node stack trace to read through. Confirmed live:

```
$ TZ=America/New_York npm start
This process must run with a UTC+8, non-DST timezone (Asia/Manila) — every "date-only" value in
this app, and a hand-written database CHECK constraint, assume it. Detected UTC offset -4h
instead. Set TZ=Asia/Manila in the environment before starting the app (see .env.example,
Dockerfile).
```
Exit code 1, nothing else printed. If a container fails to come up, check
its logs for this line before anything else — it means the platform's
environment/timezone configuration is wrong, not that the app crashed.

## Release checklist

1. **Run the full verification suite** against a production build:
   ```
   npm run typecheck
   npm run lint
   npm test
   npm run build
   PW_PROD_SERVER=1 npx playwright test
   ```
   All must pass. See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) if the
   Playwright suite shows sporadic failures under full-suite load — that's
   a documented, pre-existing category unrelated to a real regression, but
   confirm nothing new is failing.

2. **Apply database migrations against the real (non-dev) database** —
   not `db push`, not `migrate dev`, both of which are dev-only tools
   that can drift or reset data:
   ```
   npm run db:migrate:deploy
   ```
   This runs `prisma migrate deploy`, reading `DATABASE_URL` from the
   environment — point it at the real production Postgres instance, not
   `localhost`. Confirm the app server (or wherever this command runs)
   can actually reach that host/port first — a managed Postgres provider
   typically needs an allowlisted IP or a VPC/private-network route, and
   `prisma migrate deploy` will just hang or time out on a network it
   can't reach, which looks like a stuck deploy, not a clear error.
   Applies every migration in `prisma/migrations/` in order; safe to run
   on every deploy since already-applied migrations are skipped. Take a
   backup first (see [BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md)) —
   migrations that add indexes/constraints are low-risk, but always back
   up before a schema change against real data.

3. **Bootstrap the first Owner account — see its own section below**
   for the full procedure and the safety guarantees around it.

4. **Set every required environment variable** (table above) on the
   hosting platform, including `AUTH_SECRET` and a correct `DATABASE_URL`.

5. **Start the app** with `npm run build && npm run start` (or your
   platform's equivalent) — never `npm run dev` in production.

6. **Verify the health endpoint**: `GET /api/health` should return
   `{"status":"ok", "database":"connected", "uptimeSeconds":..., "checkedInMs":...}`
   with a `200` status. If `status` is `"error"` (the route also returns
   `503` in that case) or `database` is `"disconnected"`, the app is up but
   can't reach Postgres — check `DATABASE_URL` and network/firewall rules
   before anything else. Configured provider names (payment/email/upload)
   aren't exposed on this public endpoint — check
   `/dashboard/admin/diagnostics` (step 7 below) for those.

7. **Sign in as Owner and check `/dashboard/admin/diagnostics`** (requires
   the `system:admin` permission — Owner/Manager have it by default). It
   surfaces the same health data plus a few operational counts (users,
   today's bookings, unresolved inventory alerts) as a one-page deployment
   sanity check.

8. **Confirm rate limiting is live**: attempt to sign in with a wrong
   password 10+ times in under 5 minutes for the same account — the 11th
   attempt should be silently rejected the same way a wrong password is
   (no distinguishing error message, by design, so an attacker can't tell
   the difference between "wrong password" and "rate limited").

## Bootstrap: the first Owner account

`prisma/seed.ts` is what creates every login-capable account, every role/
permission, and every reference catalog (courts, equipment, payment
methods, capacity defaults). It refuses to run at all against
`NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is explicitly set —
this is the ONLY way to bootstrap a genuinely empty production database,
since there's no separate admin-creation UI.

```
ALLOW_PROD_SEED=true npm run db:seed
```

**Safe to run more than once — verified, not just claimed.** Two
properties, both confirmed live against a real database before this was
written up:

- **The Owner password is set once, never reset.** The Owner user's
  `passwordHash` is written only when the row is first created — a
  second seed run (deliberate, or an automation pipeline that still has
  `ALLOW_PROD_SEED` set from the bootstrap run) leaves an
  already-changed password untouched. Verified: changed the Owner's
  password directly, ran the seed script twice under
  `NODE_ENV=production`, confirmed the changed password survived both
  runs. Log output tells you which case you're in — "Seeded Owner
  login — change this password immediately after first login" on a true
  first run, "Owner account already exists — password left untouched"
  on every run after.
- **No dev/test fixtures are created in production, under any flag
  combination.** Earlier versions of this script also created a second,
  undocumented known-password login ("Test Receptionist") and a dozen-
  plus fake sample players whenever `ALLOW_PROD_SEED=true` was set —
  exactly what a genuine production bootstrap requires. Both are now
  gated on `NODE_ENV` directly, independent of `ALLOW_PROD_SEED` — there
  is no flag combination that creates them in production. Verified live
  against a clean database state.

Procedure for a genuinely new production database:

1. `npm run db:migrate:deploy` first (see the release checklist above).
2. `ALLOW_PROD_SEED=true npm run db:seed` — creates the Owner account
   (username `owner`, password `Owner123!`) plus every reference
   catalog row, and nothing else.
3. Sign in as Owner immediately and change the password. Unlike earlier
   versions of this script, forgetting this step and re-running the seed
   later will NOT silently revert it — but change it anyway, promptly.
4. Unset `ALLOW_PROD_SEED` (or don't persist it) — there's no reason for
   it to stay set once bootstrap is done, and leaving it set is no longer
   the credential risk it used to be, but it's still not meant to be a
   standing configuration.

## Guarantee: no test or fixture data reaches production

Two independent, verified guarantees — this project has a real prior
incident to point at (an unlocked concurrency test corrupting a *dev*
database's pairing history mid-session; recoverable there because it was
dev data, not something to risk against a real one):

1. **Seeding**: dev-only fixtures (the Test Receptionist login, sample
   players) are gated on `NODE_ENV !== "production"` directly — see
   above. `ALLOW_PROD_SEED` only ever opts into the Owner bootstrap.
2. **Integration tests**: every `*.integration.ts` script is destructive
   by design — each creates fixture rows and deletes them (or anything
   matching its own cleanup query) as part of its lifecycle.
   `scripts/run-integration-tests.ts` (what `npm run test:integration`
   actually runs) refuses outright when `NODE_ENV=production`, no
   override flag — there is no legitimate reason to ever point these at
   a real database. Verified: blocks with a clear message under
   `NODE_ENV=production`, runs normally otherwise. This guards the
   documented, scripted entry point; a developer directly invoking a
   single `npx tsx some.integration.ts` file locally is using their own
   `.env` by choice, a different risk than automation pointing the
   documented command at the wrong database.

## TV display — not yet built

BUILD-SPEC.md's build order names the TV display, `/api/display`, and
the TV setup page as Phase 10 — checked, and confirmed nothing exists
yet (`docs/tv-display.html` is a static design mockup only, matching
`docs/design-reference.html`'s role — no route, no component, no API
handler anywhere in the codebase). There is nothing to document yet
about its URL, auth, or offline/reboot recovery behavior, since none of
that has been built. This section is a placeholder for Phase 10 — fill
it in when that phase lands, before any venue TV is pointed at this app.

## Rolling back

There is no automated rollback tooling. To roll back a bad deploy:

1. Redeploy the previous application build/image.
2. If the bad deploy included a migration, `prisma migrate deploy` does not
   support rolling back automatically — restore from the backup taken in
   step 2 above (see [BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md)) if the
   migration needs to be undone, or hand-write a down-migration if the
   schema change is additive-only (e.g. dropping an index/constraint that
   was just added is safe and reversible without data loss).

## Logging

`lib/logger.ts` wraps Pino — JSON output in production (suitable for a log
aggregator), pretty-printed in development. Every action-layer failure logs
via `logger.error({ err, action, userId }, "Action failed")` before
returning a friendly message to the client, so a production incident always
has a server-side trail even though the user only sees a generic error.
