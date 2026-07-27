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
| `OWNER_INITIAL_PASSWORD` | No | **Yes, if set** | Only read during the first-ever production seed run (the Owner row doesn't exist yet). If unset, a random one is generated and printed once instead — see "Bootstrap" below. |

Copy `.env.example` as a starting point and fill in real values — never
commit a real `.env`. `.env.example` does not list `AUTH_GOOGLE_ID` /
`AUTH_GOOGLE_SECRET` / `FEATURE_GOOGLE_LOGIN` — Google login isn't
implemented in this version of the app (checked: no reference anywhere
in the codebase); don't configure them.

## Domain and HTTPS (thecourtroomkalibo.com)

`thecourtroomkalibo.com` is already registered and managed through
Cloudflare. Once the droplet exists and has a public IP:

1. In the Cloudflare dashboard, add (or update) an **A record** for
   `thecourtroomkalibo.com` (and `www`, if used) pointing at the
   droplet's public IP.
2. Leave the record **proxied** (orange cloud, not grey "DNS only") —
   this is what gives HTTPS automatically: Cloudflare terminates TLS at
   its edge with its own certificate, so nothing needs to be configured
   on the droplet itself (no separate Let's Encrypt/Certbot step) for
   the public hostname to serve over `https://`.
3. Under Cloudflare's SSL/TLS settings, use **Full** (or **Full
   (strict)** if the origin presents a valid certificate of its own)
   rather than **Flexible**, so the leg between Cloudflare and the
   origin is encrypted too, not just the leg between Cloudflare and the
   visitor.
4. Confirm it: `https://thecourtroomkalibo.com` should load with a
   valid, browser-trusted certificate within a few minutes — a
   Cloudflare-proxied record generally doesn't need the usual DNS TTL
   wait. If it doesn't, check that the record is actually proxied (not
   "DNS only") before looking anywhere else.
5. Only once the domain resolves, set `AUTH_URL=https://thecourtroomkalibo.com`
   (see "Environment variables" above) — Auth.js uses this for callback
   URLs, and changing it after real users have started signing in means
   invalidating and re-issuing sessions.

Per BUILD-SPEC.md §14 ("Deployment architecture"), the droplet is the
app's actual origin — it's where `next start` runs directly, not a
tunnel or reverse-proxy endpoint in front of a separate machine. This
is the droplet's public IP Cloudflare needs.

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

**Under a restart policy, this becomes a crash loop — make sure the
message lands somewhere that outlives the crashed container, not just
its own now-gone stdout.** No specific hosting platform is wired up yet
(`docker-compose.yml` deliberately has no `app` service — see its own
comment), so this is guidance for whichever one is chosen, not a tested
behavior:

- **Ship container logs to something persistent** (a log driver backed
  by disk, or a log aggregator) before relying on this message being
  readable after the fact. A container that's being restarted every few
  seconds has stdout that exists only as long as that specific container
  instance does — if nothing is capturing it centrally, the one line
  that explains the failure disappears with each restart, and what's
  left to observe from outside is just "the app won't stay up," with no
  reason why.
- **Don't let the restart policy retry forever, silently, at full
  speed.** A misconfiguration (wrong `TZ`, a missing `AUTH_SECRET`)
  isn't self-healing — restarting won't fix it, so an unbounded,
  tight restart loop just burns platform resources while looking "up"
  to anything watching only the container's running/not-running state.
  Prefer a policy with backoff and either a max retry count or alerting
  on restart count / crash-loop status specifically (most platforms
  expose this — e.g. Kubernetes' `CrashLoopBackOff` pod status) — a
  shallow "is it running" check won't catch this on its own, since the
  container IS down between restarts, just not for long enough for a
  naive check to notice.

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

   **Stop any running dev/app server first.** A live server sharing the
   same `.next` directory corrupts the build it's currently writing to —
   confirmed live: an in-progress `npm run build` run alongside a still-
   running `npm run dev` produced a broken, mismatched output.

2. **Apply database migrations — see the dedicated "Migrations and
   rollback" section below** for the exact command, why it's a
   deliberate manual step rather than something that runs automatically,
   what to do if it fails partway, and which migrations are safe to
   revert versus not.

3. **Bootstrap the first Owner account — see its own section below**
   for the full procedure and the safety guarantees around it.

4. **Point the domain at the droplet — see "Domain and HTTPS" above**
   for the concrete DNS/Cloudflare steps. Do this early: propagation and
   certificate issuance take a few minutes, and step 5 below wants the
   domain already resolving.

5. **Set every required environment variable** (table above) on the
   hosting platform, including `AUTH_SECRET`, a correct `DATABASE_URL`,
   and `AUTH_URL` now that the domain resolves.

6. **Start the app** with `npm run build && npm run start` (or your
   platform's equivalent) — never `npm run dev` in production.

7. **Verify the health endpoint**: `GET /api/health` should return
   `{"status":"ok", "database":"connected", "uptimeSeconds":..., "checkedInMs":...}`
   with a `200` status. If `status` is `"error"` (the route also returns
   `503` in that case) or `database` is `"disconnected"`, the app is up but
   can't reach Postgres — check `DATABASE_URL` and network/firewall rules
   before anything else. Configured provider names (payment/email/upload)
   aren't exposed on this public endpoint — check
   `/dashboard/admin/diagnostics` (step 8 below) for those.

8. **Sign in as Owner and check `/dashboard/admin/diagnostics`** (requires
   the `system:admin` permission — Owner/Manager have it by default). It
   surfaces the same health data plus a few operational counts (users,
   today's bookings, unresolved inventory alerts) as a one-page deployment
   sanity check.

9. **Confirm rate limiting is live**: attempt to sign in with a wrong
   password 10+ times in under 5 minutes for the same account — the 11th
   attempt should be silently rejected the same way a wrong password is
   (no distinguishing error message, by design, so an attacker can't tell
   the difference between "wrong password" and "rate limited").

## Migrations and rollback

**Command, and why it's a deliberate step, not automatic:**

```
npm run db:migrate:deploy
```

This runs `prisma migrate deploy`, reading `DATABASE_URL` from the
environment — point it at the real production Postgres instance, not
`localhost`. Confirm the app server (or wherever this command runs) can
actually reach that host/port first — a managed Postgres provider
typically needs an allowlisted IP or a VPC/private-network route, and
`prisma migrate deploy` will just hang or time out on a network it can't
reach, which looks like a stuck deploy, not a clear error.

Nothing in this repo runs migrations automatically. Checked, not
assumed: the Dockerfile's `CMD` is `["npm", "start"]` — plain `next
start`, no migration step — and no `postinstall`/`prestart` hook in
`package.json` runs one either. This is deliberate: coupling a schema
change to every container boot means a platform-triggered restart (a
crash, a scale event, a health-check failure) could attempt a migration
against a live database with nobody watching and no fresh backup taken
first. Migrating is its own step, run once, deliberately, before
restarting the app with the new code — same ordering as the release
checklist above.

**Verified against a genuinely fresh database, not just the dev one**
(which was never a real test of this — it was built up incrementally,
migration by migration, in the correct order, as each was authored;
`prisma migrate deploy` against a truly empty database exercises a path
the dev database's history never did). This surfaced a real bug: migration
folders were named with plain, unpadded integers (`0_baseline` ...
`15_tab_review_fixes`), and Prisma sorts them as strings, not numbers —
against an empty database it applied `0`, `1`, then jumped straight to
`10` (skipping `2`-`9` entirely) and failed, because migration `10`
references a table migration `9` creates. Fixed by zero-padding `0`-`9`
to two digits; re-verified clean against both a fresh database (all 16
apply in order) and the existing dev database (`prisma migrate deploy`
reports "No pending migrations to apply" — its tracking table was
updated to match the renamed folders, nothing else changed).

**If a migration fails partway:**

Prisma's own guidance, printed directly in the failure output, is real
and worth following: <https://pris.ly/d/migrate-resolve>. Concretely:

1. Don't immediately re-run `prisma migrate deploy` — a partially-applied
   migration can make the retry fail differently (e.g. "relation already
   exists" for whatever DID get created), which is confusing when
   you're already trying to figure out what state you're in.
2. Inspect what actually landed: query `_prisma_migrations` for the
   failed migration's row (it will show a `finished_at` of `NULL` and
   the error in `logs`), and check the target tables/columns directly
   against what that migration's `migration.sql` was supposed to do.
3. Decide, don't guess: if the remaining statements in that
   `migration.sql` are safe to run by hand from where it stopped, do
   that, then tell Prisma it succeeded: `npx prisma migrate resolve
   --applied <migration_name>`. If the change needs to be undone
   instead, manually revert whatever partial changes were made, then
   `npx prisma migrate resolve --rolled-back <migration_name>` — then
   fix the migration (or restore from the backup taken beforehand) and
   retry `migrate deploy`.
4. This is exactly why the backup in step 2 of the release checklist
   isn't optional — `migrate resolve` tells Prisma what happened, it
   doesn't undo a partial schema change for you.

**Which migrations are reversible, which aren't — checked directly, not
guessed:** every migration in `prisma/migrations/` is purely additive
(`CREATE TABLE`, `ADD COLUMN`, `ADD CONSTRAINT`, `CREATE INDEX`) *except
one* — `03_v11_subphase2_sales_engine`, which drops `Payment.method` and
the `PaymentMethod` enum type, replacing them with a `PaymentMethod`
table and a `paymentMethodId` foreign key. If that migration ever runs
again against a database with real `Payment.method` data, that data is
gone — there is no down-migration that can recover the original enum
values from just the replacement FK, because the mapping itself is what
gets destroyed. Not a live concern for THIS migration specifically
(production doesn't exist yet, so it will only ever run against zero
rows) — recorded here because the same shape of risk applies to any
future migration that drops or transforms a column with real production
data in it: back up first, always, and know before running it whether
it's additive or not. Confirmed via `grep -iE "DROP COLUMN|DROP
TABLE|ALTER COLUMN.*TYPE" prisma/migrations/*/migration.sql` — exactly
one match, in `03_v11_subphase2_sales_engine`.

**Rolling back the app version, and what a schema mismatch does to it:**
see "Rolling back" below — the answer depends on whether the migration
you'd be rolling back past was additive or not.

**Does the app need to stop during migration?** Not strictly, for an
additive migration — the old running app code doesn't reference columns
it doesn't know exist yet, so `ADD COLUMN`/`CREATE TABLE`/`ADD
CONSTRAINT` alongside live traffic is safe in principle. One real
caveat, checked rather than assumed: every `CREATE INDEX` in this
migration set (134 of them, across all 16 migrations) runs *without*
`CONCURRENTLY` — Prisma's default migrations run inside a transaction,
which `CREATE INDEX CONCURRENTLY` can't do — so each one briefly takes a
lock that blocks writes to that table for the duration. For this app's
data volume that should be sub-second to a few seconds, not a real
outage, but it isn't literally zero-impact. Given this is already a
deliberately simple, single-instance app with no load balancer or
zero-downtime deploy machinery (see "Known limitation" above), the
simpler and recommended default is still a brief stop-migrate-start
window rather than trying to prove every future migration is safe to run
live — that guarantee would need re-deriving for every new migration,
and the cost of a short pause is low for a single venue.

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

**The initial password is never the dev default (`Owner123!`) in
production.** That fixed value is a real, documented dev convenience
(docs/INSTALLATION.md) — fine there, but once the password is set only
once and never reset (above), a hardcoded default in production would
become a *permanent* weak credential for whoever forgets to change it.
Resolved in order: `OWNER_INITIAL_PASSWORD` if you set one explicitly,
otherwise a fresh random value (32 hex characters) generated at creation
and printed exactly once in the same log line. Verified live: a
production seed run with no override logs a real random password, not
the dev default; setting `OWNER_INITIAL_PASSWORD` is honored when
present.

Procedure for a genuinely new production database:

1. `npm run db:migrate:deploy` first (see "Migrations and rollback"
   above).
2. `ALLOW_PROD_SEED=true npm run db:seed` — creates the Owner account
   (username `owner`, a generated password printed once, or
   `OWNER_INITIAL_PASSWORD` if you set one) plus every reference catalog
   row, and nothing else. **Capture the printed password immediately —
   it is never shown again and nothing else recovers it.** If it's lost
   before first login, the only way back in is a direct database update
   (hash a new password with bcrypt, `UPDATE "User" SET
   "passwordHash" = ... WHERE email = 'owner@thecourtroom.local'`) —
   there is no self-service "forgot password" flow in this version of
   the app.
3. Sign in as Owner immediately and change the password anyway, even
   though it's already random — least-privilege habit, not a gap this
   script leaves open. Unlike earlier versions of this script,
   forgetting this step and re-running the seed later will NOT silently
   revert it either way.
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

There is no automated rollback tooling. Redeploying the previous
application build/image is always the first step — the app itself is
stateless (JWT sessions, no in-process state, see "Known limitation"
above), so that part alone is safe and lossless.

**What happens next depends entirely on whether the migration you'd be
rolling back past was additive or not** — see "Migrations and rollback"
above for how to tell:

- **Additive migration** (the common case — every migration except
  `03_v11_subphase2_sales_engine` today): the previous app version
  predates the new columns/tables, but that's fine — old code that
  never references them doesn't break just because they exist. Redeploy
  the old build; no schema change needed. The new columns/tables sit
  unused until the next real deploy.
- **Destructive/lossy migration** (dropped or transformed a column the
  old app code still expects): the previous app version **cannot run**
  against the new schema — it will error the moment it touches the
  column that's gone. There is no "hand-write a down-migration" fix that
  recovers data that was already dropped. The only way back is
  restoring the pre-migration backup (see
  [BACKUP_RECOVERY.md](./BACKUP_RECOVERY.md)) taken in the migration
  step above — which means losing any writes made between the migration
  and the decision to roll back. This is the actual reason the backup
  step is not optional, not just caution for its own sake.

## Logging

`lib/logger.ts` wraps Pino — JSON output in production (suitable for a log
aggregator), pretty-printed in development. Every action-layer failure logs
via `logger.error({ err, action, userId }, "Action failed")` before
returning a friendly message to the client, so a production incident always
has a server-side trail even though the user only sees a generic error.
