-- CreateEnum
CREATE TYPE "SpecialStagedSlot" AS ENUM ('NEXT_UP', 'AFTER_THAT', 'THEN');

-- AlterTable
ALTER TABLE "SpecialOpenPlayCheckIn" ADD COLUMN     "stagedSlot" "SpecialStagedSlot";
