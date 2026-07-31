-- Hand-written, same reason migrations 11/12 are — Prisma 7 has no
-- CHECK-constraint syntax in schema.prisma, so this object only exists
-- here and is invisible to Prisma's schema diffing.
--
-- Reported live, revenue-affecting: walk-in registration on a Friday or
-- Saturday was ALWAYS routed into the P150 unlimited capacity system,
-- at every hour of the day, because the OpenPlayNightRegistration_
-- session_matches_weekday constraint (migration 11, timezone-fixed in
-- migration 12) hard-forbade a Fri/Sat registration from ever having a
-- null sessionId. Full audit (see session notes) traced this to
-- BUILD-SPEC.md §0's original "Open play — two different modes" table,
-- a pure day-of-week split with no time-of-day concept — accurate when
-- written, incomplete now that Fri/Sat daytime (before the evening
-- unlimited session's own cutoff) genuinely runs regular per-game open
-- play too, same as any weeknight. The constraint was enforcing that
-- now-incomplete rule correctly, not guarding against a downstream
-- consumer bug — every money-handling and reporting call site was
-- already sessionId- or Sale-link-shape-driven, not date-driven,
-- confirmed by tracing each one before this migration was written.
--
-- New rule: Fri/Sat MAY have a session (both null and set are valid —
-- regular per-game walk-ins coexist with capacity-session registrants
-- on the same date now). Every other day is UNCHANGED — sessionId must
-- still be null; a session can never exist on a non-Fri/Sat date.
ALTER TABLE "OpenPlayNightRegistration"
  DROP CONSTRAINT "OpenPlayNightRegistration_session_matches_weekday";

ALTER TABLE "OpenPlayNightRegistration"
  ADD CONSTRAINT "OpenPlayNightRegistration_session_matches_weekday"
  CHECK (
    (EXTRACT(DOW FROM date + INTERVAL '8 hours') NOT IN (5, 6) AND "sessionId" IS NULL)
    OR
    (EXTRACT(DOW FROM date + INTERVAL '8 hours') IN (5, 6))
  );
