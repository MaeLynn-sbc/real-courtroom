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

Validated at startup by `lib/env.ts` — the app throws immediately on an
invalid or missing required variable rather than failing later.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | Yes (usually set by the platform) | `production` in prod. Also gates the seed guard below. |
| `DATABASE_URL` | Yes | Postgres connection string. |
| `AUTH_SECRET` | Yes | Generate with `npx auth secret`. Rotating it invalidates every existing session. |
| `AUTH_URL` | Recommended | The app's public URL (e.g. `https://courtroom.example.com`). Auth.js infers it otherwise, but setting it explicitly avoids surprises behind a proxy. |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Only if `FEATURE_GOOGLE_LOGIN=true` | Leave unset to keep Google login disabled. |
| `FEATURE_GOOGLE_LOGIN` / `FEATURE_PAYMENTS` / `FEATURE_OPEN_PLAY` / `FEATURE_TOURNAMENTS` / `FEATURE_MEMBERSHIPS` / `FEATURE_EQUIPMENT_RENTALS` | No | `"true"`/`"false"` strings. Only `FEATURE_GOOGLE_LOGIN` currently has an effect. |
| `PAYMENT_PROVIDER` | No | Only `"local"` exists today. |
| `EMAIL_PROVIDER` | No | Only `"console"` exists today — no real email is sent in this version of the app. |
| `UPLOAD_PROVIDER` | No | Only `"local"` exists today. |
| `LOG_LEVEL` | No | One of `fatal/error/warn/info/debug/trace`. Use `info` or `warn` in production; `debug`/`trace` are verbose. |
| `ALLOW_PROD_SEED` | No | Must be `"true"` to run `npm run db:seed` when `NODE_ENV=production`. See the seed guard section below. |

Copy `.env.example` as a starting point and fill in real values — never
commit a real `.env`.

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

2. **Apply database migrations** (not `db push`, not `migrate dev`):
   ```
   npm run db:migrate:deploy
   ```
   This runs `prisma migrate deploy`, which applies every migration in
   `prisma/migrations/` in order. Safe to run on every deploy — already-
   applied migrations are skipped. Take a backup first (see
   [BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md)) — migrations that add
   indexes/constraints are low-risk, but always back up before a schema
   change against real data.

3. **Seed only on a genuinely new database.** `prisma/seed.ts` is
   idempotent (every write is an `upsert`), but it also creates a
   known-password Owner account (username `owner` / password
   `Owner123!`) — running it against a live production database with real
   users would (re)create that account. The script refuses to run when
   `NODE_ENV=production` unless `ALLOW_PROD_SEED=true` is explicitly set.
   If you do need to seed a fresh production database, set that variable
   for the one seed run only, then unset it — and change the Owner
   account's password immediately after first login.

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
