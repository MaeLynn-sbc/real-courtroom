-- Cash's twin of GcashDailyBalance (migration 25). One row per calendar
-- day (date-scoped, not shift-scoped — cash is treated as one shared
-- running float for the whole business, alongside — not instead of —
-- the existing per-shift drawer reconciliation on Shift).

-- CreateEnum
CREATE TYPE "CashDailyBalanceStatus" AS ENUM ('OPEN', 'CONFIRMED');

-- CreateTable
CREATE TABLE "CashDailyBalance" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startingBalanceCents" INTEGER NOT NULL,
    "expectedEndingBalanceCents" INTEGER,
    "confirmedEndingBalanceCents" INTEGER,
    "varianceCents" INTEGER,
    "notes" TEXT,
    "status" "CashDailyBalanceStatus" NOT NULL DEFAULT 'OPEN',
    "confirmedByEmployeeId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDailyBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashDailyBalance_date_key" ON "CashDailyBalance"("date");

-- CreateIndex
CREATE INDEX "CashDailyBalance_date_idx" ON "CashDailyBalance"("date");

-- CreateIndex
CREATE INDEX "CashDailyBalance_status_idx" ON "CashDailyBalance"("status");

-- AddForeignKey
ALTER TABLE "CashDailyBalance" ADD CONSTRAINT "CashDailyBalance_confirmedByEmployeeId_fkey" FOREIGN KEY ("confirmedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
