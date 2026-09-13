-- Where inside the court time the coaching sits (coach complaint,
-- 2026-09-13).
--
-- Migration 78 made the fee rate x hours, defaulting to 1 hour, and left
-- the coach's window as the parent booking's full span. So the coach's
-- SMS, the coaching list and the availability calendar all still said
-- "5:00 PM-7:00 PM" for a 2-hour booking whose customer bought (and was
-- charged for) one hour. The coach turned up for two.
--
-- startOffsetHours = whole hours after Booking.startAt that coaching
-- begins. The coached window is [startAt + offset, + hours]. Relative to
-- the booking on purpose: moving the booking moves the coaching with it.
--
-- BACKFILL 0 = "the first hour(s) of the booking". That is the only
-- honest reading of what was sold so far, and the identity for every
-- 1-hour booking (45 of 50 historically). TOUCHES NO MONEY: Sale rows
-- are write-once snapshots and nothing prices from this column.

ALTER TABLE "CoachSession"
  ADD COLUMN "startOffsetHours" INTEGER NOT NULL DEFAULT 0;

UPDATE "CoachSession" SET "startOffsetHours" = 0 WHERE "startOffsetHours" IS DISTINCT FROM 0;

ALTER TABLE "CoachSession"
  ADD CONSTRAINT "CoachSession_startOffsetHours_nonnegative" CHECK ("startOffsetHours" >= 0);
