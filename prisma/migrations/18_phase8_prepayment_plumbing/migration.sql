-- Phase 8 plumbing (BUILD-SPEC.md §8) — schema only. Every value/table
-- added here is unreachable from any service or route until Gate 2 wires
-- it in. The public booking flow's default behavior is unchanged by this
-- migration: no existing column's default, nullability, or meaning
-- changes, and every new column is nullable or has a safe default so
-- existing rows are untouched.

-- AlterEnum
-- Four new BookingStatus values for the GCash-prepayment flow, matching
-- OpenPlayNightRegistrationStatus's naming for the equivalent Fri/Sat
-- flow. Existing values are untouched — Postgres enum values can only be
-- appended, never reordered or removed, which matches the instruction to
-- not rename/remove anything anyway.
ALTER TYPE "BookingStatus" ADD VALUE 'AWAITING_PAYMENT';
ALTER TYPE "BookingStatus" ADD VALUE 'PENDING_VERIFICATION';
ALTER TYPE "BookingStatus" ADD VALUE 'REJECTED';
ALTER TYPE "BookingStatus" ADD VALUE 'REFUNDED';

-- AlterTable
-- Nullable, no default: NULL for every existing booking and for every
-- STAFF booking going forward. Set only at public hold creation, and
-- explicitly nulled again the moment proof is submitted — see the
-- column's comment in schema.prisma.
ALTER TABLE "Booking" ADD COLUMN "holdExpiresAt" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "BookingPaymentProofStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "BookingPaymentProof" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "gcashReference" TEXT NOT NULL,
    "screenshotStorageKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "BookingPaymentProofStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedByEmployeeId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingPaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingCredit" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "sourceBookingId" TEXT NOT NULL,
    "usedByBookingId" TEXT,

    CONSTRAINT "BookingCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRefund" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BookingPaymentProof_bookingId_idx" ON "BookingPaymentProof"("bookingId");

-- CreateIndex
CREATE INDEX "BookingPaymentProof_status_idx" ON "BookingPaymentProof"("status");

-- CreateIndex
CREATE INDEX "BookingCredit_phone_idx" ON "BookingCredit"("phone");

-- CreateIndex
CREATE INDEX "BookingCredit_sourceBookingId_idx" ON "BookingCredit"("sourceBookingId");

-- CreateIndex
CREATE INDEX "BookingRefund_bookingId_idx" ON "BookingRefund"("bookingId");

-- CreateIndex
CREATE INDEX "BookingRefund_employeeId_idx" ON "BookingRefund"("employeeId");

-- AddForeignKey
ALTER TABLE "BookingPaymentProof" ADD CONSTRAINT "BookingPaymentProof_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingPaymentProof" ADD CONSTRAINT "BookingPaymentProof_resolvedByEmployeeId_fkey" FOREIGN KEY ("resolvedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCredit" ADD CONSTRAINT "BookingCredit_sourceBookingId_fkey" FOREIGN KEY ("sourceBookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingCredit" ADD CONSTRAINT "BookingCredit_usedByBookingId_fkey" FOREIGN KEY ("usedByBookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRefund" ADD CONSTRAINT "BookingRefund_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRefund" ADD CONSTRAINT "BookingRefund_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written — not derived from `prisma migrate diff`. Prisma 7 has no
-- partial/conditional unique index syntax in schema.prisma, so this is
-- invisible to Prisma's schema diffing. See BookingPaymentProof's comment
-- in prisma/schema.prisma, and OpenPlayNightRegistration's hand-written
-- CHECK constraint/trigger (migration 11) for the same pattern.
--
-- The fraud check (BUILD-SPEC.md §8 "unique across all payments") is
-- narrower than "this string appears once in the table, ever": a
-- reference number rejected for a bad screenshot (not a bad payment)
-- must be resubmittable against the same booking. So uniqueness is
-- scoped to the two non-terminal-rejected outcomes — PENDING and
-- APPROVED — not to REJECTED rows, which don't count.
CREATE UNIQUE INDEX "BookingPaymentProof_gcashReference_active_key"
  ON "BookingPaymentProof" ("gcashReference")
  WHERE status IN ('PENDING', 'APPROVED');
