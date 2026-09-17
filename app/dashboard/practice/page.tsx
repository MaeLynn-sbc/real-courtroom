import type { Metadata } from "next";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { RotationBoard } from "@/features/open-play-capacity/components/rotation-board";
import { serializeBoard } from "@/features/open-play-capacity/lib/serialize-rotation-board";
import { PracticeBills } from "@/features/practice/components/practice-bills";
import { PracticeControls } from "@/features/practice/components/practice-controls";
import { PRACTICE_DATE_VALUE, practiceDate } from "@/lib/practice";
import { prisma } from "@/lib/prisma";
import { openPlayRotationService } from "@/services/open-play/open-play-rotation.service";
import { practiceService } from "@/services/open-play/practice.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Practice",
};

export const dynamic = "force-dynamic";

// Practice (owner, 2026-09-17): the real rotation board — Send to Next
// up, staged sets, court assignment, timers, Time's up — running on
// sample names on the practice date (lib/practice.ts). Once it works the
// way the venue wants, this flow replaces regular open play and unli
// play. Nothing on this page can create a tab or a sale.
export default async function PracticePage() {
  const date = practiceDate();
  const [board, openPlaySettings, takeoverRtv, registrations, bills] = await Promise.all([
    openPlayRotationService.getRotationBoardData(date),
    settingsService.getOpenPlaySettings(),
    settingsService.getPracticeTakeoverRtv(),
    prisma.openPlayNightRegistration.findMany({
      where: { date },
      select: { id: true, playerName: true, skillLevel: true, status: true },
      orderBy: { registeredAt: "asc" },
    }),
    practiceService.getPracticeBills(),
  ]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Practice</h1>
          <p className="text-muted-foreground text-sm">
            Try the open play line with sample names. Not real players, not charged, not in sales.
          </p>
        </div>
        <Link
          href="/rtv"
          target="_blank"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Open /rtv
        </Link>
      </div>

      <PracticeControls
        takeoverRtv={takeoverRtv}
        players={registrations.map((r) => ({
          registrationId: r.id,
          playerName: r.playerName,
          skillLevel: r.skillLevel,
          status: r.status,
        }))}
      />

      <RotationBoard
        {...serializeBoard(PRACTICE_DATE_VALUE, board, openPlaySettings.targetGameMinutes)}
      />

      <PracticeBills bills={bills} />
    </div>
  );
}
