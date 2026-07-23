-- CreateTable
CREATE TABLE "ReferenceCounter" (
    "scope" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReferenceCounter_pkey" PRIMARY KEY ("scope")
);

-- One-time backfill (v1.1 maintenance): seed each scope's counter from the
-- highest sequence number already used in existing reference strings, so
-- the new atomic counter doesn't collide with pre-existing data the moment
-- it starts issuing numbers. Parses "<PREFIX>-YYYYMMDD-NNNN" (or "EMP-NNNN"
-- for Employee, which has no date component) via substring(). GREATEST
-- guards against re-running this migration re-lowering an already-advanced
-- counter.

-- Booking: "BK-YYYYMMDD-NNNN" (2-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'BOOKING:' || substring("bookingReference" from 4 for 8),
       MAX(substring("bookingReference" from 13)::int)
FROM "Booking"
GROUP BY substring("bookingReference" from 4 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- Membership: "MB-YYYYMMDD-NNNN" (2-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'MEMBERSHIP:' || substring("membershipReference" from 4 for 8),
       MAX(substring("membershipReference" from 13)::int)
FROM "Membership"
GROUP BY substring("membershipReference" from 4 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- Shift: "SHIFT-YYYYMMDD-NNN" (5-char prefix, 3-digit sequence)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'SHIFT:' || substring("shiftNumber" from 7 for 8),
       MAX(substring("shiftNumber" from 16)::int)
FROM "Shift"
GROUP BY substring("shiftNumber" from 7 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- EquipmentRental: "ER-YYYYMMDD-NNNN" (2-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'EQUIPMENT_RENTAL:' || substring("rentalReference" from 4 for 8),
       MAX(substring("rentalReference" from 13)::int)
FROM "EquipmentRental"
GROUP BY substring("rentalReference" from 4 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- LockerRental: "LR-YYYYMMDD-NNNN" (2-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'LOCKER_RENTAL:' || substring("rentalReference" from 4 for 8),
       MAX(substring("rentalReference" from 13)::int)
FROM "LockerRental"
GROUP BY substring("rentalReference" from 4 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- Sale: "SALE-YYYYMMDD-NNNN" (4-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'SALE:' || substring("saleNumber" from 6 for 8),
       MAX(substring("saleNumber" from 15)::int)
FROM "Sale"
GROUP BY substring("saleNumber" from 6 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- Employee: "EMP-NNNN" (4-char prefix, no date component, one global scope)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'EMPLOYEE', MAX(substring("employeeNumber" from 5)::int)
FROM "Employee"
HAVING COUNT(*) > 0
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- OpenPlaySession: "OP-YYYYMMDD-NNNN" (2-char prefix)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'OPEN_PLAY_SESSION:' || substring("sessionReference" from 4 for 8),
       MAX(substring("sessionReference" from 13)::int)
FROM "OpenPlaySession"
GROUP BY substring("sessionReference" from 4 for 8)
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);

-- OpenPlayMatch: plain Int column, scoped per session (no date/prefix parsing needed)
INSERT INTO "ReferenceCounter" (scope, value)
SELECT 'OPEN_PLAY_MATCH:' || "openPlaySessionId", MAX("matchNumber")
FROM "OpenPlayMatch"
GROUP BY "openPlaySessionId"
ON CONFLICT (scope) DO UPDATE SET value = GREATEST("ReferenceCounter".value, EXCLUDED.value);
