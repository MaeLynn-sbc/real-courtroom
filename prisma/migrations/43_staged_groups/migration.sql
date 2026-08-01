-- CreateEnum
CREATE TYPE "StagedGroupSlot" AS ENUM ('NEXT_UP', 'AFTER_THAT', 'THEN');

-- CreateEnum
CREATE TYPE "StagedGroupSource" AS ENUM ('MANUAL', 'AUTO_QUEUE');

-- AlterTable
ALTER TABLE "QueueEntry" ADD COLUMN     "stagedGroupId" TEXT;

-- CreateTable
CREATE TABLE "StagedGroup" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "slot" "StagedGroupSlot" NOT NULL,
    "source" "StagedGroupSource" NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StagedGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StagedGroup_date_slot_key" ON "StagedGroup"("date", "slot");

-- CreateIndex
CREATE INDEX "QueueEntry_stagedGroupId_idx" ON "QueueEntry"("stagedGroupId");

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_stagedGroupId_fkey" FOREIGN KEY ("stagedGroupId") REFERENCES "StagedGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
