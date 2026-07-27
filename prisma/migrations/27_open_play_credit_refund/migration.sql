-- Open-play cancellation policy Gate 1 — OpenPlayCredit (customer
-- cancellation before the 4-hour cutoff, non-refundable-but-creditable)
-- and OpenPlayRefund (staff-initiated cash refund for a genuine error),
-- mirroring BookingCredit/BookingRefund exactly.
--
-- RENUMBERED at merge time: three branches independently claimed a
-- migration number off the same main@24 base (GCash's 25, expenses'
-- 25, and this one's original 26). Merge order was GCash -> expenses
-- (renumbered 25 -> 26) -> this one (renumbered 26 -> 27), same
-- "renumber on conflict" precedent as the earlier coaching merge
-- (migration 18 -> 20). Folder renamed, no content changes.

-- CreateTable
CREATE TABLE "OpenPlayCredit" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "sourceRegistrationId" TEXT NOT NULL,
    "usedByRegistrationId" TEXT,

    CONSTRAINT "OpenPlayCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenPlayRefund" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpenPlayRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenPlayCredit_phone_idx" ON "OpenPlayCredit"("phone");

-- CreateIndex
CREATE INDEX "OpenPlayCredit_sourceRegistrationId_idx" ON "OpenPlayCredit"("sourceRegistrationId");

-- CreateIndex
CREATE INDEX "OpenPlayRefund_registrationId_idx" ON "OpenPlayRefund"("registrationId");

-- CreateIndex
CREATE INDEX "OpenPlayRefund_employeeId_idx" ON "OpenPlayRefund"("employeeId");

-- AddForeignKey
ALTER TABLE "OpenPlayCredit" ADD CONSTRAINT "OpenPlayCredit_sourceRegistrationId_fkey" FOREIGN KEY ("sourceRegistrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayCredit" ADD CONSTRAINT "OpenPlayCredit_usedByRegistrationId_fkey" FOREIGN KEY ("usedByRegistrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayRefund" ADD CONSTRAINT "OpenPlayRefund_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayRefund" ADD CONSTRAINT "OpenPlayRefund_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
