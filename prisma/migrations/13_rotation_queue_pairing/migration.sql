-- CreateEnum
CREATE TYPE "GameAssignmentSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "GameAssignmentStatus" AS ENUM ('PROPOSED', 'ACTIVE', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "GameAssignment" (
    "id" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "sessionId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "skillSpread" INTEGER NOT NULL,
    "source" "GameAssignmentSource" NOT NULL,
    "createdByUserId" TEXT,
    "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "status" "GameAssignmentStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameAssignmentParticipant" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameAssignmentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecentPairing" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "registrationIdA" TEXT NOT NULL,
    "registrationIdB" TEXT NOT NULL,
    "gameCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecentPairing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameAssignment_date_status_idx" ON "GameAssignment"("date", "status");

-- CreateIndex
CREATE INDEX "GameAssignment_courtId_status_idx" ON "GameAssignment"("courtId", "status");

-- CreateIndex
CREATE INDEX "GameAssignment_sessionId_idx" ON "GameAssignment"("sessionId");

-- CreateIndex
CREATE INDEX "GameAssignmentParticipant_registrationId_idx" ON "GameAssignmentParticipant"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "GameAssignmentParticipant_assignmentId_registrationId_key" ON "GameAssignmentParticipant"("assignmentId", "registrationId");

-- CreateIndex
CREATE INDEX "RecentPairing_date_idx" ON "RecentPairing"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RecentPairing_date_registrationIdA_registrationIdB_key" ON "RecentPairing"("date", "registrationIdA", "registrationIdB");

-- AddForeignKey
ALTER TABLE "GameAssignment" ADD CONSTRAINT "GameAssignment_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssignment" ADD CONSTRAINT "GameAssignment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssignment" ADD CONSTRAINT "GameAssignment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssignmentParticipant" ADD CONSTRAINT "GameAssignmentParticipant_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "GameAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameAssignmentParticipant" ADD CONSTRAINT "GameAssignmentParticipant_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

