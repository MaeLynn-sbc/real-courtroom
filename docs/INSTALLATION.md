# Installation & Local Setup

This guide gets TCPMS running on a fresh machine for local development. For
production deployment, see [DEPLOYMENT.md](./DEPLOYMENT.md) instead.

## Prerequisites

- Node.js 20+
- PostgreSQL 16 — either via `docker-compose.yml` (recommended, no local
  install needed) or a native install
- npm (ships with Node)

## 1. Install dependencies

```
npm install
```

## 2. Start PostgreSQL

**Option A — Docker (recommended):**

```
docker compose up -d
```

This starts Postgres 16 on port 5432 (db `tcpms_dev`, user `courtroom`) and
Adminer (a web DB browser) on [http://localhost:8080](http://localhost:8080).

**Option B — native PostgreSQL install:** create a database and user matching
`.env.example`'s `DATABASE_URL`, or point `DATABASE_URL` at your own
instance. `docker-compose.yml`'s credentials (`courtroom` /
`courtroom_dev_password`, db `tcpms_dev`) are the reference values used
throughout the rest of this doc set.

## 3. Configure environment variables

```
cp .env.example .env
```

Then edit `.env`:
- `DATABASE_URL` — already correct for the Docker setup above; adjust for a
  native install.
- `AUTH_SECRET` — generate one with `npx auth secret` and paste the output
  in. Required; the app will not start without it.
- Everything else in `.env.example` has a working default for local dev
  (Google login stays disabled, feature flags default appropriately,
  service abstractions default to their local/console implementations).

## 4. Apply the database schema

```
npm run db:generate
npx prisma migrate deploy
npm run db:seed
```

`db:generate` regenerates the Prisma client. `prisma migrate deploy` applies
every migration in `prisma/migrations/` in order (safe to re-run — it skips
migrations already applied). `db:seed` creates baseline fixtures (courts,
lockers, an equipment catalog, membership plans, ~14 sample players) and one
Owner account:

- Username: `owner`
- Password: `Owner123!`

**Do not use this account or password in production.** `prisma/seed.ts`
refuses to run against `NODE_ENV=production` unless `ALLOW_PROD_SEED=true`
is explicitly set — see [DEPLOYMENT.md](./DEPLOYMENT.md).

If you're iterating on `prisma/schema.prisma` locally and don't need a real
migration file yet, `npx prisma db push` applies the current schema directly
without creating a migration — faster for exploratory changes, but it does
not produce a `prisma/migrations/` entry. Use `prisma migrate dev` (needs a
DB user with `CREATEDB`) or hand-roll a migration via `prisma migrate diff`
once a change is ready to commit.

## 5. Run the app

```
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) and sign in with the
Owner credentials above.

## 6. Verify the install

```
npm run typecheck
npm run lint
npm test
npm run build
```

All four should pass cleanly on a fresh install. For a live smoke check,
hit [http://localhost:3000/api/health](http://localhost:3000/api/health) —
it should return `{"status":"ok", "database":"connected", ...}`.

## Running the Playwright suite

```
npx playwright test
```

Reuses whatever dev server is already running on port 3000, or starts one
itself. Requires a seeded database (step 4) — every spec's `describe` block
says so in its title. Set `PW_PROD_SERVER=1` to run against a production
build (`next build && next start`) instead of `next dev` — slower to start,
but avoids dev-mode's on-demand compilation entirely. See
[TROUBLESHOOTING.md](./TROUBLESHOOTING.md) if the suite behaves
inconsistently under full-suite load.

## Common first-run issues

| Symptom | Cause | Fix |
|---|---|---|
| App throws "Invalid environment variables" on startup | `AUTH_SECRET` missing/empty, or `DATABASE_URL` malformed | Check `.env` against `.env.example`; regenerate `AUTH_SECRET` with `npx auth secret` |
| `prisma.court` (or any model) is `undefined` at runtime despite typechecking | Stale generated Prisma client | `rm -rf lib/generated/prisma && npm run db:generate` |
| Login redirects to `/unauthorized` for every user | Dev server started before a schema/seed change landed | Fully restart `npm run dev` (not just hot-reload) after any schema change |
| `next dev` fails with an `ENOENT ... vendor-chunks` error | Stale `.next` cache from mixing `next build` and `next dev` | `rm -rf .next` before restarting `npm run dev` |
