-- Gate 2 review follow-up (BUILD-SPEC.md §9): the Fri/Sat ₱150 walk-in
-- registration fee has been real cash collected at the desk since Phase
-- 7 (registerWalkIn marks CONFIRMED immediately, "cash paid at the
-- desk"), but had no Sale row and no payment-method attribution at all
-- — sales reporting hardcoded this bucket to ₱0 with an explicit
-- "not yet built" note. This migration adds the linked-record column
-- Sale needs to attribute that fee, same one-to-one @unique shape as
-- every other SaleCategory's own linked-record column
-- (Sale.playerTabId, Sale.bookingId, etc.) — nullable, since not every
-- OpenPlayNightRegistration has this fee's Sale (online-source rows,
-- pre-existing WALK_IN rows created before this migration, and
-- weeknight registrations never will).

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "openPlayNightRegistrationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Sale_openPlayNightRegistrationId_key" ON "Sale"("openPlayNightRegistrationId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_openPlayNightRegistrationId_fkey" FOREIGN KEY ("openPlayNightRegistrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;
