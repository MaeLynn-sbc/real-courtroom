# Backup & Recovery

TCPMS keeps all state in one PostgreSQL database — there is no other
persisted state to back up (uploaded files use the `local` provider only in
this version of the app; sessions are stateless JWTs). Back up the database
on whatever schedule matches your risk tolerance, and always before running
a migration against production.

## Taking a backup

Use `pg_dump`'s custom format (`-Fc`) — compressed, and the only format
`pg_restore` can selectively restore from or parallelize:

```
pg_dump -h <host> -U <user> -d <database> -Fc -f tcpms_backup_$(date +%Y%m%d_%H%M%S).dump
```

On Windows, if `pg_dump` isn't on `PATH`, call it directly from the
PostgreSQL install (adjust the version number to match yours):

```
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -h localhost -U courtroom -d tcpms_dev -Fc -f tcpms_backup.dump
```

You'll be prompted for the database password unless `PGPASSWORD` is set in
the environment (or a `.pgpass` file is configured) — avoid hardcoding the
password directly in a script or shell history.

**Automate this.** A cron job / scheduled task running `pg_dump` on a
regular interval (e.g. nightly) and shipping the resulting `.dump` file to
storage outside the database host is the minimum viable backup strategy.
This project has no built-in scheduler to do this for you — see
[DEPLOYMENT.md](./DEPLOYMENT.md) for the single-instance-deployment context
this assumes.

## Restoring a backup

**To a fresh/empty database:**

```
createdb -h <host> -U <user> tcpms_restored
pg_restore -h <host> -U <user> -d tcpms_restored --no-owner --no-privileges tcpms_backup.dump
```

`--no-owner --no-privileges` avoids failures when the restoring role
doesn't exactly match the role that created the original dump — safe for a
single-app-owner database like this one.

**Restoring over an existing database** (disaster recovery — replacing
current, presumably-bad state): drop and recreate the database first, then
restore as above. This is destructive to whatever is currently in that
database — confirm you have the backup you actually want before running
`dropdb`.

```
dropdb -h <host> -U <user> tcpms_dev
createdb -h <host> -U <user> tcpms_dev
pg_restore -h <host> -U <user> -d tcpms_dev --no-owner --no-privileges tcpms_backup.dump
```

After restoring, run `npm run db:generate` and confirm `prisma migrate
status` reports the database as up to date with `prisma/migrations/` — a
backup taken before a migration was applied will need `npm run
db:migrate:deploy` run again after restore.

## Verifying a backup is actually restorable

A backup you've never test-restored is not a verified backup. Periodically
(and always after a major schema change):

1. Take a backup of the live database as above.
2. Restore it into a **scratch database** (never restore over the live
   database as a test):
   ```
   createdb -h <host> -U <user> tcpms_restore_check
   pg_restore -h <host> -U <user> -d tcpms_restore_check --no-owner --no-privileges tcpms_backup.dump
   ```
3. Compare row counts between the source and scratch database for a few
   key tables — they should match exactly:
   ```sql
   SELECT 'User' AS tbl, count(*) FROM "User"
   UNION ALL SELECT 'Booking', count(*) FROM "Booking"
   UNION ALL SELECT 'Player', count(*) FROM "Player"
   UNION ALL SELECT 'Tournament', count(*) FROM "Tournament";
   ```
   Run the same query against both databases and diff the results.
4. Drop the scratch database once verified:
   ```
   dropdb -h <host> -U <user> tcpms_restore_check
   ```

This is exactly the procedure that was run to verify Phase 10's production-
hardening backup/restore requirement — see the Phase 10 addendum in
[ARCHITECTURE.md](../ARCHITECTURE.md) for the result.

## What's not covered

- **Point-in-time recovery** (restoring to an arbitrary moment between
  backups, via WAL archiving) is not configured — the procedure above only
  restores to the moment a specific `pg_dump` was taken. If you need
  point-in-time recovery, configure it at the PostgreSQL/infrastructure
  level (e.g. a managed Postgres provider's built-in PITR); it's outside
  what this application-level doc can set up for you.
- **Uploaded files** — this version of the app has no live file-upload
  feature (the `local` upload provider abstraction exists but nothing
  calls it), so there's nothing to back up there yet.
