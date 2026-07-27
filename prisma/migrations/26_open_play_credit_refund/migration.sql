-- Open-play cancellation policy Gate 1 — OpenPlayCredit (customer
-- cancellation before the 4-hour cutoff, non-refundable-but-creditable)
-- and OpenPlayRefund (staff-initiated cash refund for a genuine error),
-- mirroring BookingCredit/BookingRefund exactly.
--
-- NOTE for merge time: as of this writing, the shared dev database
-- already has BOTH 25_expenses_tracking AND 25_gcash_daily_reconciliation
-- applied (two branches independently claimed migration 25, cut from the
-- same main point at migration 24 — see either migration's own comment).
-- This migration takes the next available number, 26, on the assumption
-- it lands after at least one of those two merges to main. If this
-- migration is actually the FIRST of the three to merge, whichever of
-- the 25s merges after it must be the one renumbered instead — same
-- "renumber on conflict" precedent as the earlier coaching merge
-- (migration 18 -> 20).

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
