-- Six more virtual racks (owner, 2026-09-17: "add 6 more rack but you
-- can minimize it when not used"). The line becomes 15 positions:
-- Next up / After that / Then, then Racks 1-12. RACK_10..RACK_15 are the
-- 10th-15th positions, shown as Rack 7..Rack 12 (lib/staged-slots.ts).
--
-- PURELY ADDITIVE: no row changes.
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_10';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_11';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_12';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_13';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_14';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_15';
