-- CreateEnum
CREATE TYPE "PayPeriodStatus" AS ENUM ('OPEN');

-- CreateTable
CREATE TABLE "EmployeeRate" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dailyRateCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "EmployeeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayPeriod" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "PayPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeRate_employeeId_effectiveFrom_idx" ON "EmployeeRate"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeRate_employeeId_effectiveFrom_key" ON "EmployeeRate"("employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayPeriod_startDate_idx" ON "PayPeriod"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "PayPeriod_startDate_endDate_key" ON "PayPeriod"("startDate", "endDate");

-- AddForeignKey
ALTER TABLE "EmployeeRate" ADD CONSTRAINT "EmployeeRate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeRate" ADD CONSTRAINT "EmployeeRate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
