
-- CreateEnum
CREATE TYPE "OpenPlayNightStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OpenPlayCapacityDefault" (
    "id" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPlayCapacityDefault_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenPlayNightSession" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "OpenPlayNightStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPlayNightSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OpenPlayCapacityDefault_dayOfWeek_key" ON "OpenPlayCapacityDefault"("dayOfWeek");

-- CreateIndex
CREATE INDEX "OpenPlayNightSession_status_idx" ON "OpenPlayNightSession"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenPlayNightSession_date_key" ON "OpenPlayNightSession"("date");

