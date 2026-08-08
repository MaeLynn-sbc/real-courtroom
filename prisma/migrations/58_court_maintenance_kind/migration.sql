-- CreateEnum
CREATE TYPE "CourtBlockKind" AS ENUM ('MAINTENANCE', 'SPECIAL_EVENT');

-- AlterTable
ALTER TABLE "CourtMaintenance" ADD COLUMN     "kind" "CourtBlockKind" NOT NULL DEFAULT 'MAINTENANCE';

-- CreateIndex
CREATE INDEX "CourtMaintenance_kind_startAt_idx" ON "CourtMaintenance"("kind", "startAt");
