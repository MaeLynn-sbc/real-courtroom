-- SMS confirmations via Semaphore (owner decision, 2026-08-28).
--
-- Adds the record that makes sending observable. Three send paths already
-- shipped (booking payment-proof, open-play payment-proof, waitlist
-- invite) and none of them recorded anything anywhere but stdout — so
-- "did that customer get their text?" had no answer, and "what did this
-- month cost?" had no answer either.
--
-- Purely additive: one table, two enums, no existing table touched, no
-- backfill. Nothing sends until SMS_PROVIDER is set regardless.

CREATE TYPE "SmsTrigger" AS ENUM (
  'OPEN_PLAY_REGISTRATION',
  'PUBLIC_BOOKING',
  -- Three triggers, all confirmations. There are deliberately NO
  -- cancellation values: venue policy is that a paid booking is
  -- non-refundable and cannot be cancelled, so no cancellation event
  -- exists to notify anyone about.
  'COACH_SESSION'
);

CREATE TYPE "SmsStatus" AS ENUM (
  -- The CLAIM state. A row is inserted QUEUED to reserve its dedupeKey
  -- BEFORE the provider is called, then updated to SENT or FAILED. A row
  -- left at QUEUED means the process died mid-send — which is the honest
  -- reading, and never a false SENT.
  'QUEUED',
  'SENT',
  'FAILED',
  'SKIPPED_INVALID',
  'SKIPPED_CAP',
  'SKIPPED_DISABLED'
);

CREATE TABLE "SmsLog" (
  "id"        TEXT NOT NULL,
  "trigger"   "SmsTrigger" NOT NULL,
  "status"    "SmsStatus" NOT NULL,
  -- NULLABLE on purpose. Postgres allows many NULLs under a unique
  -- index, which is exactly the distinction needed: a row that represents
  -- a decision about THIS entity (sent, failed, invalid number) takes the
  -- key and blocks any second attempt; a row that represents a SYSTEM
  -- state (kill switch off, daily cap hit) records the attempt with a
  -- NULL key and blocks nothing, so the entity is still textable once the
  -- system state changes.
  "dedupeKey" TEXT,
  "phone"     TEXT,
  "rawPhone"  TEXT,
  "body"      TEXT NOT NULL,
  "encoding"  TEXT,
  "segments"  INTEGER,
  "error"     TEXT,
  -- Semaphore's own message id and status string, kept so a row here can
  -- be reconciled one-to-one against the provider dashboard.
  "providerMessageId" TEXT,
  "providerStatus"    TEXT,
  -- Failure forensics. A FAILED row is only actionable if a human can
  -- tell an ambiguous timeout (the message MAY have gone out) from a flat
  -- refusal (it demonstrably did not), and can then find the corresponding
  -- entry in Semaphore's own message log.
  --   REFUSED    401/403/429 - provably not sent, frees the dedupeKey
  --   VALIDATION 400/422     - this recipient was rejected
  --   HTTP_ERROR 5xx         - AMBIGUOUS, may have been queued
  --   TIMEOUT                - AMBIGUOUS, the most likely to have sent
  --   NETWORK                - AMBIGUOUS, request may not have left
  --   REJECTED   200 + Failed/Refunded - provider declined delivery
  "failureKind" TEXT,
  "httpStatus"  INTEGER,
  -- Stamped immediately BEFORE the request leaves, so an ambiguous row can
  -- be matched against the provider dashboard by recipient and minute.
  "requestedAt" TIMESTAMP(3),
  "entityId"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

-- Unique over a NULLABLE column: many NULLs coexist, one non-null value
-- may exist once. The real guard against double-texting. Idempotency is enforced by the
-- DATABASE, not by a boolean flag a racing request could read as false
-- twice — the same reasoning migration 76 used when it replaced
-- AttendanceRecord's "already exists" check with a real constraint.
CREATE UNIQUE INDEX "SmsLog_dedupeKey_key" ON "SmsLog"("dedupeKey");

-- Serves the 200/day cap, which counts SENT rows inside a business-day
-- window before every send.
CREATE INDEX "SmsLog_createdAt_status_idx" ON "SmsLog"("createdAt", "status");

-- Serves "did we text this booking?" lookups from the admin side.
CREATE INDEX "SmsLog_trigger_entityId_idx" ON "SmsLog"("trigger", "entityId");

-- Serves the "which sends are ambiguous and need checking against the
-- provider dashboard?" query. Partial, because these rows should be rare
-- and the index should stay tiny.
CREATE INDEX "SmsLog_ambiguous_idx" ON "SmsLog"("createdAt")
  WHERE "status" = 'FAILED' AND "failureKind" IN ('HTTP_ERROR', 'TIMEOUT', 'NETWORK');
