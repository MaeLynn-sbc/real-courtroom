-- Manual "Time's up" staff call — twin of announcementRequestedAt
-- (migration 37), for calling players off the court instead of onto it.

-- AlterTable
ALTER TABLE "GameAssignment" ADD COLUMN "timesUpRequestedAt" TIMESTAMP(3);
