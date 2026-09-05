-- Assignable playoff stage on a match (owner request, 2026-09-05):
-- "i got to decide if theres quarter finals and semis and finals."
--
-- Stage names were previously DERIVED by counting backwards from the last
-- round of a full single-elimination draw, so the bracket's SIZE decided
-- whether quarterfinals existed, and a ROUND_ROBIN category got no stage
-- names at all. This makes the stage explicit, so pools can finish and the
-- organiser can then decide the playoff shape.
--
-- PURELY ADDITIVE. The column is NULLABLE with no default, so every
-- existing match is unchanged and keeps rendering exactly as it does now.
-- A SINGLE_ELIMINATION category still derives its own labels when stage is
-- null.

CREATE TYPE "MatchStage" AS ENUM ('QUARTERFINAL', 'SEMIFINAL', 'BRONZE', 'FINAL');

ALTER TABLE "Match" ADD COLUMN "stage" "MatchStage";

-- Serves "show me this category's playoff matches", which the public page
-- runs per category on every render.
CREATE INDEX "Match_tournamentCategoryId_stage_idx"
  ON "Match"("tournamentCategoryId", "stage");
