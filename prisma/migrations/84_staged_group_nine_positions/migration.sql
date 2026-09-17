-- Next up / After that / Then PLUS six racks (owner, 2026-09-17: "aside
-- from rack 1-6 I want to retain the first 3").
--
-- The line is now nine positions: NEXT_UP, AFTER_THAT, THEN (shown as
-- Next up / After that / Then, exactly as before), then RACK_4 .. RACK_9
-- (shown as Rack 1 .. Rack 6 — see lib/staged-slots.ts for the mapping).
-- Migration 83 added RACK_4-6; this adds RACK_7-9.
--
-- PURELY ADDITIVE: no row changes.
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_7';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_8';
ALTER TYPE "StagedGroupSlot" ADD VALUE IF NOT EXISTS 'RACK_9';
