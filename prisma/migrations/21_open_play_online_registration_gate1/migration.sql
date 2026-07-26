-- Open-play online self-registration (BUILD-SPEC.md §6, "PARKED"
-- subsection) — Gate 1: schema only. Same shape as Phase 8's own Gate 1
-- (18_phase8_prepayment_plumbing): every value/table added here is
-- unreachable from any service or route until a later gate wires it in.
-- The existing staff-entered registration/check-in flow's default
-- behavior is unchanged by this migration — no existing column's
-- default, nullability, or meaning changes, and every new column is
-- nullable or has a safe default so existing rows are untouched.

-- AlterEnum
-- REJECTED, mirroring Booking's exact reasoning (see
-- services/booking/booking-status.ts's comment) — a staff-rejected bad
-- GCash proof is a different event from a customer's own CANCELLED.
ALTER TYPE "OpenPlayNightRegistrationStatus" ADD VALUE 'REJECTED';

-- AlterTable
-- Nullable, no default: NULL for every existing registration and for
-- every WALK_IN registration going forward. Set only when a waitlist
-- invite creates an AWAITING_PAYMENT registration, and explicitly nulled
-- again the moment proof is submitted — mirrors Booking.holdExpiresAt
-- exactly (see that column's comment in schema.prisma).
ALTER TABLE "OpenPlayNightRegistration" ADD COLUMN     "holdExpiresAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "OpenPlayRegistrationPaymentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OpenPlayWaitlistEntryStatus" AS ENUM ('WAITING', 'INVITED', 'EXPIRED', 'CONVERTED');

-- CreateTable
CREATE TABLE "OpenPlayRegistrationPaymentProof" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "gcashReference" TEXT NOT NULL,
    "screenshotStorageKey" TEXT NOT NULL,
    "submittedAmountCents" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OpenPlayRegistrationPaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByEmployeeId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPlayRegistrationPaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpenPlayWaitlistEntry" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "skillLevel" "OpenPlaySkillLevel" NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "OpenPlayWaitlistEntryStatus" NOT NULL DEFAULT 'WAITING',
    "invitedAt" TIMESTAMP(3),
    "inviteExpiresAt" TIMESTAMP(3),
    "registrationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpenPlayWaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpenPlayRegistrationPaymentProof_registrationId_idx" ON "OpenPlayRegistrationPaymentProof"("registrationId");

-- CreateIndex
CREATE INDEX "OpenPlayRegistrationPaymentProof_status_idx" ON "OpenPlayRegistrationPaymentProof"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OpenPlayWaitlistEntry_registrationId_key" ON "OpenPlayWaitlistEntry"("registrationId");

-- CreateIndex
CREATE INDEX "OpenPlayWaitlistEntry_sessionId_status_submittedAt_idx" ON "OpenPlayWaitlistEntry"("sessionId", "status", "submittedAt");

-- AddForeignKey
ALTER TABLE "OpenPlayRegistrationPaymentProof" ADD CONSTRAINT "OpenPlayRegistrationPaymentProof_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayRegistrationPaymentProof" ADD CONSTRAINT "OpenPlayRegistrationPaymentProof_resolvedByEmployeeId_fkey" FOREIGN KEY ("resolvedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayWaitlistEntry" ADD CONSTRAINT "OpenPlayWaitlistEntry_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "OpenPlayNightSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpenPlayWaitlistEntry" ADD CONSTRAINT "OpenPlayWaitlistEntry_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "OpenPlayNightRegistration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written — not derived from `prisma migrate diff`. Prisma 7 has no
-- partial/conditional unique index syntax in schema.prisma, so this is
-- invisible to Prisma's schema diffing. Same pattern as
-- BookingPaymentProof_gcashReference_active_key (migration 18) — see
-- that index's comment and OpenPlayRegistrationPaymentProof's own
-- comment in schema.prisma for why this is NOT also cross-checked
-- against BookingPaymentProof's table (a real, accepted, flagged gap).
--
-- Uniqueness is scoped to PENDING/APPROVED only, not REJECTED — a
-- reference rejected for a bad screenshot (not a bad payment) must be
-- resubmittable against the same registration.
CREATE UNIQUE INDEX "OpenPlayRegistrationPaymentProof_gcashReference_active_key"
  ON "OpenPlayRegistrationPaymentProof" ("gcashReference")
  WHERE status IN ('PENDING', 'APPROVED');
