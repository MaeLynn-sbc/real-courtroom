
-- CreateEnum
CREATE TYPE "OpenPlaySkillLevel" AS ENUM ('BEGINNER', 'NOVICE', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "OpenPlayNightRegistrationStatus" AS ENUM ('AWAITING_PAYMENT', 'PENDING_VERIFICATION', 'CONFIRMED', 'CHECKED_OUT', 'NO_SHOW', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpenPlayNightRegistrationSource" AS ENUM ('WALK_IN', 'WEBSITE');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "openPlaySkillLevel" "OpenPlaySkillLevel";

-- CreateTable
CREATE TABLE "OpenPlayNightRegistration" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playerId" TEXT,
    "playerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "skillLevel" "OpenPlaySkillLevel" NOT NULL,
    "source" "OpenPlayNightRegistrationSource" NOT NULL,
    "status" "OpenPlayNightRegistrationStatus" NOT NULL DEFAULT 'CONFIRMED',
    "waitlistPos" INTEGER,
    "partyId" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPlayNightRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenPlayNightRegistration_sessionId_status_idx" ON "OpenPlayNightRegistration"("sessionId", "status");

-- CreateIndex
CREATE INDEX "OpenPlayNightRegistration_sessionId_waitlistPos_idx" ON "OpenPlayNightRegistration"("sessionId", "waitlistPos");

-- AddForeignKey
ALTER TABLE "OpenPlayNightRegistration" ADD CONSTRAINT "OpenPlayNightRegistration_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayNightRegistration" ADD CONSTRAINT "OpenPlayNightRegistration_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

