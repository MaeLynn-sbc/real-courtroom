-- Payroll Batch 1 closeout.
--
-- 1. Drop @@unique([employeeId, workDate]). It made a split day
--    impossible: an employee working an opening AND a closing shift could
--    only ever have one attendance record. Uniqueness is replaced at the
--    service layer by an OVERLAP guard — two records on the same day are
--    legitimate, two records covering the same minutes are not, which is
--    the invariant actually worth protecting.
--
--    Dropping a unique index can never fail on existing data (it only
--    permits more), so this needs no backfill or pre-check.
DROP INDEX "AttendanceRecord_employeeId_workDate_key";

-- The lookup pattern stays — computeEmployeePeriod and listEntries both
-- filter by employee and workDate range — so the index survives without
-- the uniqueness.
CREATE INDEX "AttendanceRecord_employeeId_workDate_idx"
  ON "AttendanceRecord"("employeeId", "workDate");

-- 2. clockOut must be after clockIn.
--
--    This was previously enforced ONLY by the Zod schema the two server
--    actions happen to call, so any caller reaching the service directly
--    — a script, a seed, a future batch — could persist a negative shift
--    that payroll would then compute as negative worked minutes. Now
--    guarded in three places: the schema (fast feedback), the service
--    (the real boundary), and here (the last word).
--
--    NULL clockOut is allowed: an open, not-yet-closed shift is a real
--    state, distinct from a backwards one.
--
--    ⚠ This CHECK is validated against existing rows when added. Local
--    dev has 0 AttendanceRecord rows; production must be confirmed clean
--    before this is applied there (see the deploy note in the report).
ALTER TABLE "AttendanceRecord"
  ADD CONSTRAINT "AttendanceRecord_clockOut_after_clockIn"
  CHECK ("clockOut" IS NULL OR "clockOut" > "clockIn");
