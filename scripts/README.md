# scripts/

One-off and repeatable operational scripts.

## Commit your one-off scripts

⚠ **Known issue, logged 2026-08-18 — this has now happened twice.**

Two production data changes were made by scripts that were never
committed:

1. **`Sale.businessDate` backfill (2026-08-12).** Migration 69 added the
   column nullable, and the schema comment promised "a one-off script
   backfills every existing row once". That script does not exist in any
   commit on any branch. Whether it ran could only be established days
   later by querying production directly — it had, but nothing in the
   repo said so.
2. **30 `AttendanceRecord` rows (2026-08-13 17:16).** ~2.5 weeks of
   historical attendance loaded in a single minute, audit-logged as the
   owner, through `attendanceRecordService.createManualEntry` called
   directly rather than through the server action. That bypassed the Zod
   refine, which at the time was the *only* `clockOut > clockIn` check —
   the service-level and DB-level guards did not exist until
   `24e6d1c` / migration 76.

Neither script was reviewable, repeatable, or auditable after the fact.

**The convention:** a script that writes to production gets committed
here before it is run, even if it will only ever run once. It costs
nothing and it means the next person can answer "did this run, and what
exactly did it do?" from the repo instead of from a psql prompt.

Existing examples to follow: `backfill-booking-source.ts`,
`backfill-coaching-fee-sales.ts`.

A script should:

- state in a header comment what it changes, why, and whether it is
  idempotent
- be idempotent where possible, so a re-run is safe
- go through the service layer where one exists, so service-level
  validation applies — and if it deliberately bypasses one, say why
- report what it changed, rather than exiting silently

## Running a script against production

Always source `.env` explicitly:

```bash
cd /opt/tcpms/app && set -a && . ./.env && set +a && npx tsx scripts/<name>.ts
```

Not a style preference — it bit us on 2026-08-26. `/etc/environment` on
the droplet carried a SECOND `DATABASE_URL` with `sslmode=require`, while
`.env` uses `sslmode=verify-full` with the DigitalOcean CA. Every login
shell inherited the weaker one, and dotenv deliberately does not override
an existing `process.env` value — so a script run by hand connected
**without verifying the database's certificate**, while the app (systemd,
`EnvironmentFile=.env`) verified correctly. The backfill script failed
outright with a TLS error, which is how it surfaced; a script that merely
connected would have downgraded silently.

That `/etc/environment` line has been removed, but the habit is the real
protection: `set -a && . ./.env` makes the file the source of truth
regardless of what the shell already has.

## Files

| Script | Purpose |
| --- | --- |
| `deploy-production.sh` | Source of truth for the droplet's `/opt/tcpms/deploy.sh`. Halts on pending migrations by design. |
| `backup-production.sh` | Source of truth for the droplet's `/opt/tcpms/backup.sh`. Nightly `pg_dump -Fc`, verifies the archive before rotating, keeps 14 days. Scheduled at 03:30 UTC (11:30 Manila) via root crontab. |
| `run-integration-tests.ts` | Runs every `*.integration.ts` in sequence. Refuses to run with `NODE_ENV=production`. |
| `backfill-booking-source.ts` | One-off: populate `Booking.source` on pre-existing rows. |
| `backfill-coaching-fee-sales.ts` | One-off: create the missing `COACHING` Sale rows for historical coach sessions. |
| `backfill-attendance-from-shifts.ts` | One-off: recover AttendanceRecord rows from closed Shift rows for days missed before shift-close seeding existed. Idempotent, dry-run by default. |
| `delete-legacy-roles.ts` | One-off: remove superseded role rows. **Currently untracked** — a live instance of exactly the problem described above. |
