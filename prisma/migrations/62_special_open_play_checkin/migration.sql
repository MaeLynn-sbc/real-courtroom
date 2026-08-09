-- CreateEnum
CREATE TYPE "SpecialOpenPlayStatus" AS ENUM ('WAITING', 'PLAYING', 'DONE');

-- CreateTable
CREATE TABLE "SpecialOpenPlayCheckIn" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "playerName" TEXT NOT NULL,
    "phone" TEXT,
    "skillLevel" "SkillLevel",
    "status" "SpecialOpenPlayStatus" NOT NULL DEFAULT 'WAITING',
    "courtLabel" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "SpecialOpenPlayCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpecialOpenPlayCheckIn_date_status_idx" ON "SpecialOpenPlayCheckIn"("date", "status");

-- AddForeignKey
ALTER TABLE "SpecialOpenPlayCheckIn" ADD CONSTRAINT "SpecialOpenPlayCheckIn_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
