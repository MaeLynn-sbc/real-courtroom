-- GCash reconciliation Gate 1. One row per calendar day (date-scoped,
-- not shift-scoped — GCash is one shared account balance for the whole
-- business, unlike a physical cash drawer handed off per shift).

-- CreateEnum
CREATE TYPE "GcashDailyBalanceStatus" AS ENUM ('OPEN', 'CONFIRMED');

-- CreateTable
CREATE TABLE "GcashDailyBalance" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startingBalanceCents" INTEGER NOT NULL,
    "expectedEndingBalanceCents" INTEGER,
    "confirmedEndingBalanceCents" INTEGER,
    "varianceCents" INTEGER,
    "notes" TEXT,
    "status" "GcashDailyBalanceStatus" NOT NULL DEFAULT 'OPEN',
    "confirmedByEmployeeId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GcashDailyBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GcashDailyBalance_date_key" ON "GcashDailyBalance"("date");

-- CreateIndex
CREATE INDEX "GcashDailyBalance_date_idx" ON "GcashDailyBalance"("date");

-- CreateIndex
CREATE INDEX "GcashDailyBalance_status_idx" ON "GcashDailyBalance"("status");

-- AddForeignKey
ALTER TABLE "GcashDailyBalance" ADD CONSTRAINT "GcashDailyBalance_confirmedByEmployeeId_fkey" FOREIGN KEY ("confirmedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
