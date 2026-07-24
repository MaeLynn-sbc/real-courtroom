-- Hand-written — not derived from `prisma migrate diff`. Prisma 7 has no
-- CHECK-constraint or trigger syntax in schema.prisma, so both objects
-- below exist only here and are invisible to Prisma's schema diffing.
-- See the comment on OpenPlayNightRegistration in prisma/schema.prisma.

-- 1. A Friday/Saturday registration must have a session; every other day
--    (including Sunday, matching this app's existing Fri/Sat-only
--    capacity-night convention — see OpenPlayCapacityService) must not.
--    EXTRACT(DOW FROM date) is deterministic given the stored column, so
--    this is a valid single-table CHECK constraint.
ALTER TABLE "OpenPlayNightRegistration"
  ADD CONSTRAINT "OpenPlayNightRegistration_session_matches_weekday"
  CHECK (
    (EXTRACT(DOW FROM date) IN (5, 6) AND "sessionId" IS NOT NULL)
    OR
    (EXTRACT(DOW FROM date) NOT IN (5, 6) AND "sessionId" IS NULL)
  );

-- 2. When sessionId is set, `date` must equal that session's own `date`
--    column. This reads a second table, so it cannot be a CHECK
--    constraint — a trigger is the only write-time enforcement option.
CREATE OR REPLACE FUNCTION open_play_registration_date_matches_session()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."sessionId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "OpenPlayNightSession"
      WHERE id = NEW."sessionId" AND date = NEW.date
    ) THEN
      RAISE EXCEPTION
        'OpenPlayNightRegistration.date (%) must match its session''s date (sessionId=%)',
        NEW.date, NEW."sessionId";
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS open_play_registration_date_matches_session ON "OpenPlayNightRegistration";
CREATE TRIGGER open_play_registration_date_matches_session
  BEFORE INSERT OR UPDATE ON "OpenPlayNightRegistration"
  FOR EACH ROW
  EXECUTE FUNCTION open_play_registration_date_matches_session();
