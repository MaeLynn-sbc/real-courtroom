-- Fixes a timezone bug in migration 11's CHECK constraint, discovered via
-- live verification: this app builds "date-only" values with `new Date(y, m,
-- d)` (JS local-timezone midnight). The venue and every locale/currency
-- string in this codebase (en-PH, ₱, thecourtroomkalibo.com) is Philippine
-- time, UTC+8, no DST. Postgres stores that instant into a `timestamp
-- without time zone` column as its raw UTC clock-face value — e.g. intended
-- "Friday 00:00 PH-local" is stored as literally "Thursday 16:00". Postgres
-- has no timezone context for a naive column, so `EXTRACT(DOW FROM date)`
-- read that raw value and returned Thursday (4) for what the app meant as
-- Friday (5) — rejecting a genuinely valid Friday registration.
--
-- Fix: shift the stored value forward by the same fixed 8-hour offset before
-- extracting day-of-week, recovering the PH-local calendar date the app
-- intended. A flat interval (not `AT TIME ZONE 'Asia/Manila'`) is used
-- deliberately — Asia/Manila has no DST, so the offset is always exactly 8
-- hours, and this avoids any dependency on Postgres's timezone database or
-- session-level TimeZone setting being configured correctly.
--
-- This assumes the Node process constructing these dates always runs with
-- its OS/container clock effectively producing PH-local midnight for
-- `new Date(y, m, d)` — i.e. TZ=Asia/Manila (or a host physically in that
-- zone). See .env / .env.example for the explicit TZ setting this depends
-- on, and docs/BUILD-SPEC.md's §14 deployment note for why this must hold
-- in production too.

ALTER TABLE "OpenPlayNightRegistration"
  DROP CONSTRAINT "OpenPlayNightRegistration_session_matches_weekday";

ALTER TABLE "OpenPlayNightRegistration"
  ADD CONSTRAINT "OpenPlayNightRegistration_session_matches_weekday"
  CHECK (
    (EXTRACT(DOW FROM date + INTERVAL '8 hours') IN (5, 6) AND "sessionId" IS NOT NULL)
    OR
    (EXTRACT(DOW FROM date + INTERVAL '8 hours') NOT IN (5, 6) AND "sessionId" IS NULL)
  );
