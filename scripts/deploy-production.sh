#!/usr/bin/env bash
# Deploy TCPMS to production. Runs ON the droplet (134.209.111.91), as
# root — systemctl restart needs root, but every git/npm/build step drops
# to the `tcpms` user (matching /opt/tcpms/app's ownership) so nothing
# ends up root-owned in a tree the app's own systemd service (User=tcpms)
# has to keep reading and writing.
#
# Encodes the repeatable subset of docs/DEPLOYMENT.md's release checklist
# (steps 1-2, 6-7) — NOT the one-time steps (Owner bootstrap, DNS, first-
# time env var setup), which stay manual and are out of scope here.
#
# This file is the source of truth (tracked in the repo); the copy that
# actually runs lives at /opt/tcpms/deploy.sh, OUTSIDE the app directory,
# so `git reset --hard` below can never overwrite the very script that's
# running it mid-execution.
set -euo pipefail

APP_DIR=/opt/tcpms/app
SERVICE=tcpms.service
HEALTH_URL="http://127.0.0.1:3000/api/health"
HOME_URL="http://127.0.0.1:3000/"

as_tcpms() {
  su -s /bin/bash tcpms -c "cd $APP_DIR && $1"
}

echo "==> Current version: $(as_tcpms 'git log -1 --oneline')"

echo "==> Fetching origin/main"
as_tcpms "git fetch origin"

echo "==> Resetting to origin/main (discards any local drift — package-lock.json etc, all generated, never hand-edited on this box)"
as_tcpms "git checkout -- ." || true
as_tcpms "git reset --hard origin/main"

echo "==> Installing dependencies"
as_tcpms "npm ci"

echo "==> Generating Prisma client"
as_tcpms "npx prisma generate"

echo "==> Checking migration status"
STATUS_OUTPUT=$(as_tcpms "npx prisma migrate status" 2>&1) || true
echo "$STATUS_OUTPUT"
if echo "$STATUS_OUTPUT" | grep -q "have not yet been applied"; then
  echo ""
  echo "==> STOPPING: pending migrations found (listed above)."
  echo "    Per docs/DEPLOYMENT.md's own 'Migrations and rollback' section,"
  echo "    applying a migration is a deliberate, manual step — never"
  echo "    automatic — because some migrations are destructive/lossy and"
  echo "    need a backup taken first (see that section for which ones)."
  echo "    Nothing has been built or restarted. To proceed:"
  echo "      1. Take a backup if the pending migration(s) aren't purely"
  echo "         additive (docs/BACKUP_RECOVERY.md)."
  echo "      2. Run: su -s /bin/bash tcpms -c 'cd $APP_DIR && npx prisma migrate deploy'"
  echo "      3. Re-run this script."
  exit 1
fi
echo "==> No pending migrations"

echo "==> Building"
as_tcpms "npm run build"

echo "==> Restarting $SERVICE"
systemctl restart "$SERVICE"

echo "==> Waiting for the app to come back up"
for i in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/tmp/health-check.json 2>/dev/null; then
    break
  fi
  sleep 2
done

echo "==> Health check:"
cat /tmp/health-check.json 2>/dev/null && echo || echo "FAILED — no response from $HEALTH_URL"

echo "==> Real page check:"
curl -fsSo /dev/null -w "  GET / -> %{http_code}\n" "$HOME_URL" || echo "  GET / -> FAILED"

echo "==> Deployed: $(as_tcpms 'git log -1 --oneline')"
