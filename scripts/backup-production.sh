#!/usr/bin/env bash
# Nightly logical backup of the TCPMS database, run ON the droplet as root.
#
# This file is the source of truth (tracked in the repo); the copy that
# actually runs lives at /opt/tcpms/backup.sh, OUTSIDE the app directory,
# for the same reason deploy-production.sh does — the deploy script runs
# `git reset --hard` on the app dir and must never be able to clobber an
# operational script mid-execution.
#
# Why this exists (2026-08-26): there was no working backup at all. The
# droplet shipped with postgresql-client-16 while the managed database is
# PostgreSQL 18, so every pg_dump attempt failed with
#   "aborting because of server version mismatch"
# — discovered while trying to take a pre-migration backup for migration
# 76. That migration was DDL-only so nothing was at risk, but the next
# migration that rewrites rows would have had no safety net. Fixed by
# installing postgresql-client-18 from the PGDG apt repo.
#
# docs/BACKUP_RECOVERY.md's own "Automate this" note asked for exactly
# this and it had never been done.
set -euo pipefail

APP_DIR=/opt/tcpms/app
BACKUP_DIR=/opt/tcpms/backups
RETAIN_DAYS=14

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR"

# DATABASE_URL contains the password — sourced, never echoed. Nothing
# below prints it, and the dump filename carries no credentials.
set -a
# shellcheck disable=SC1091
. ./.env
set +a

TS=$(date +%Y%m%d_%H%M%S)
OUT="$BACKUP_DIR/tcpms_${TS}.dump"

# -Fc (custom format): compressed, and the only format pg_restore can
# filter selectively — see docs/BACKUP_RECOVERY.md.
pg_dump "$DATABASE_URL" -Fc -f "$OUT"

# A dump that cannot be listed is not a backup. Verify before trusting it,
# and refuse to rotate anything if this one is unreadable.
if ! pg_restore --list "$OUT" >/dev/null 2>&1; then
  echo "FAILED: $OUT is not a readable pg_dump archive — keeping all older backups." >&2
  exit 1
fi

TABLES=$(pg_restore --list "$OUT" | grep -c "TABLE DATA" || true)
if [ "$TABLES" -lt 50 ]; then
  echo "FAILED: only $TABLES tables with data in $OUT — refusing to rotate." >&2
  exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "OK: $OUT ($SIZE, $TABLES tables with data)"

# Rotate only AFTER the new dump has been verified, so a run of failures
# can never leave the box with nothing.
DELETED=$(find "$BACKUP_DIR" -name 'tcpms_*.dump' -type f -mtime "+$RETAIN_DAYS" -print -delete | wc -l)
echo "Retention: kept $RETAIN_DAYS days, removed $DELETED old dump(s)."
