-- Coaching sessions, Gate 1 (revised per review) — a payment-ready
-- sibling of the Booking system. CoachSession.bookingId is required,
-- unique, and ON DELETE CASCADE: a coach session with no court booking
-- is unrepresentable at the DB level, not just prevented by app logic.
-- date/time/court are deliberately NOT duplicated on CoachSession — they
-- live on the parent Booking and are read through that relation.
-- CoachRate is per-coach (coachId + groupSize unique), not
-- facility-wide. Sale.coachSessionId and SaleCategory.COACHING are
-- inert placeholders for Phase 8 — nothing writes to them this round.
-- CreateEnum
CREATE TYPE "CoachSessionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAID', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CoachSessionSource" AS ENUM ('PUBLIC', 'STAFF', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "SaleCategory" ADD VALUE 'COACHING';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "isCoach" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "coachSessionId" TEXT;

-- CreateTable
CREATE TABLE "CoachSession" (
    "id" TEXT NOT NULL,
    "sessionReference" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "bookedById" TEXT NOT NULL,
    "playerId" TEXT,
    "groupSize" INTEGER NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "status" "CoachSessionStatus" NOT NULL DEFAULT 'PENDING',
    "source" "CoachSessionSource" NOT NULL DEFAULT 'UNKNOWN',
    "isOutsideAvailability" BOOLEAN NOT NULL DEFAULT false,
    "guestName" TEXT,
    "guestPhone" TEXT,
    "guestEmail" TEXT,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachSessionHistory" (
    "id" TEXT NOT NULL,
    "coachSessionId" TEXT NOT NULL,
    "status" "CoachSessionStatus" NOT NULL,
    "note" TEXT,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoachSessionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachAvailabilityWindow" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachAvailabilityWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoachRate" (
    "id" TEXT NOT NULL,
    "coachId" TEXT NOT NULL,
    "groupSize" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoachRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CoachSession_sessionReference_key" ON "CoachSession"("sessionReference");

-- CreateIndex
CREATE UNIQUE INDEX "CoachSession_bookingId_key" ON "CoachSession"("bookingId");

-- CreateIndex
CREATE INDEX "CoachSession_coachId_idx" ON "CoachSession"("coachId");

-- CreateIndex
CREATE INDEX "CoachSession_status_idx" ON "CoachSession"("status");

-- CreateIndex
CREATE INDEX "CoachSession_playerId_idx" ON "CoachSession"("playerId");

-- CreateIndex
CREATE INDEX "CoachSessionHistory_coachSessionId_idx" ON "CoachSessionHistory"("coachSessionId");

-- CreateIndex
CREATE INDEX "CoachAvailabilityWindow_coachId_startAt_endAt_idx" ON "CoachAvailabilityWindow"("coachId", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "CoachRate_coachId_groupSize_key" ON "CoachRate"("coachId", "groupSize");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_coachSessionId_key" ON "Sale"("coachSessionId");

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_bookedById_fkey" FOREIGN KEY ("bookedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSession" ADD CONSTRAINT "CoachSession_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSessionHistory" ADD CONSTRAINT "CoachSessionHistory_coachSessionId_fkey" FOREIGN KEY ("coachSessionId") REFERENCES "CoachSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachSessionHistory" ADD CONSTRAINT "CoachSessionHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachAvailabilityWindow" ADD CONSTRAINT "CoachAvailabilityWindow_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoachRate" ADD CONSTRAINT "CoachRate_coachId_fkey" FOREIGN KEY ("coachId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_coachSessionId_fkey" FOREIGN KEY ("coachSessionId") REFERENCES "CoachSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
