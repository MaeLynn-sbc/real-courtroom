
-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('WAITING', 'PLAYING', 'RESTING', 'DONE');

-- DropForeignKey
ALTER TABLE "OpenPlayNightRegistration" DROP CONSTRAINT "OpenPlayNightRegistration_sessionId_fkey";

-- AlterTable
ALTER TABLE "OpenPlayNightRegistration" ADD COLUMN     "checkedInAt" TIMESTAMP(3),
ADD COLUMN     "date" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "sessionId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "QueueEntry" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "sessionId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "playerName" TEXT NOT NULL,
    "skillLevel" "OpenPlaySkillLevel" NOT NULL,
    "partyId" TEXT,
    "joinedQueueAt" TIMESTAMP(3) NOT NULL,
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'WAITING',
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "lastPlayedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QueueEntry_registrationId_key" ON "QueueEntry"("registrationId");

-- CreateIndex
CREATE INDEX "QueueEntry_date_status_idx" ON "QueueEntry"("date", "status");

-- CreateIndex
CREATE INDEX "QueueEntry_sessionId_status_idx" ON "QueueEntry"("sessionId", "status");

-- CreateIndex
CREATE INDEX "OpenPlayNightRegistration_date_idx" ON "OpenPlayNightRegistration"("date");

-- AddForeignKey
ALTER TABLE "OpenPlayNightRegistration" ADD CONSTRAINT "OpenPlayNightRegistration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

