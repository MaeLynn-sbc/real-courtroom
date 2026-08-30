-- Coaching billed per hour (owner decision, 2026-08-29).
--
-- CoachRate.priceCents was already meant as an hourly rate, but nothing
-- multiplied it: the fee was charged flat while CoachSession took its
-- start/end from the parent booking. So a coach on a 3-hour booking
-- worked 3 hours and was billed for 1. Five sessions to date, PHP 3,400
-- undercharged.
--
-- BACKFILL IS DELIBERATELY hours = 1 FOR EVERY EXISTING ROW, including
-- the 5 that ran longer. Setting those to their true span would make
-- historical revenue report ~PHP 3,400 higher than what was actually
-- taken, on days that are already reconciled and CONFIRMED. The gap is
-- real and belongs in a note, not in the data.
--
-- TOUCHES NO MONEY. This alters CoachSession only. Sale rows are
-- write-once snapshots (recordCoachSessionFeeSale copies rateCents into
-- Sale.amountCents at creation and nothing updates it afterwards), and
-- no report or reconciliation path reads CoachSession for revenue —
-- verified by grep across services/reporting, /cash, /gcash, /sales and
-- /analytics. It is also the identity operation numerically: the old
-- behaviour was effectively x 1.

ALTER TABLE "CoachSession"
  ADD COLUMN "hours" INTEGER NOT NULL DEFAULT 1;

-- Belt and braces. The DEFAULT above already backfills every existing
-- row to 1; this states it explicitly so the intent survives in the
-- migration history rather than being implied by a default clause.
UPDATE "CoachSession" SET "hours" = 1 WHERE "hours" IS DISTINCT FROM 1;

-- A session must buy at least one hour. Guards a script or a future
-- caller writing 0 or a negative, which would produce a zero or negative
-- coaching fee.
ALTER TABLE "CoachSession"
  ADD CONSTRAINT "CoachSession_hours_positive" CHECK ("hours" >= 1);
