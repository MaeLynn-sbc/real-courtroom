-- Gate 1: shift cash reconciliation. Completes existing, half-built
-- functionality — Shift.varianceCents has existed since v1.1 but was
-- never computed (its own comment said so explicitly: "stays null until
-- a Sale model exists" — a Sale model has existed for a while, this was
-- just never wired up). This migration only adds the new denomination-
-- breakdown audit-trail column; varianceCents itself needs no schema
-- change, only application code to actually compute and write it.

-- AlterTable
ALTER TABLE "Shift" ADD COLUMN     "closingCashBreakdown" JSONB;
