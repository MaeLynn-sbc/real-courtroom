-- Six virtual paddle racks (owner, 2026-09-17: "the racks would be
-- named 1-6, like a virtual paddle stacking").
--
-- The three existing slots stay exactly as they are and become Racks
-- 1-3 on screen (NEXT_UP, AFTER_THAT, THEN — their stored names don't
-- change, so every existing StagedGroup row keeps its meaning). Three
-- more are added for Racks 4-6.
--
-- PURELY ADDITIVE: no row changes. ALTER TYPE ... ADD VALUE is safe in
-- a transaction on PostgreSQL 12+ (production runs 18) as long as the new
-- values aren't used in the same transaction, and they aren't.
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_4';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_5';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_6';
