-- CreateTable
CREATE TABLE "PayrollMarkedDate" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "PayrollMarkedDate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollMarkedDate_date_key" ON "PayrollMarkedDate"("date");

-- AddForeignKey
ALTER TABLE "PayrollMarkedDate" ADD CONSTRAINT "PayrollMarkedDate_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
