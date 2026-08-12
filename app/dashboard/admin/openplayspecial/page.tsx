import type { Metadata } from "next";

import { SpecialOpenPlayBoard } from "@/features/open-play-special/components/special-open-play-board";
import { computeBusinessDate } from "@/lib/business-date";
import { specialOpenPlayService } from "@/services/open-play-special/special-open-play.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Special Open Play — Private",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Owner request (2026-08-09): "an outside special court" — a second,
// isolated open-play setup (check-in + manual court assignment only,
// no auto-pairing, no Sale, no PlayerTab, no TV connection) for a
// physically separate court, explicitly temporary — see
// SpecialOpenPlayCheckIn's own schema comment for the full isolation
// rationale. Lives under /dashboard/admin, inheriting SYSTEM_ADMIN from
// the parent rbac.ts rule — "visible only to me."
export default async function OpenPlaySpecialPage() {
  // Owner-directed consolidation (2026-08-12): rollover-hour aware, not
  // literal calendar midnight.
  const courtHours = await settingsService.getCourtHours();
  const today = computeBusinessDate(new Date(), courtHours.businessDateRolloverHour);
  const checkIns = await specialOpenPlayService.listForDate(today);

  return (
    <SpecialOpenPlayBoard
      dateValue={toDateValue(today)}
      checkIns={checkIns.map((checkIn) => ({
        id: checkIn.id,
        playerName: checkIn.playerName,
        phone: checkIn.phone,
        skillLevel: checkIn.skillLevel,
        status: checkIn.status,
        courtLabel: checkIn.courtLabel,
        startedAt: checkIn.startedAt ? checkIn.startedAt.toISOString() : null,
        timerStartedAt: checkIn.timerStartedAt ? checkIn.timerStartedAt.toISOString() : null,
        stagedSlot: checkIn.stagedSlot,
      }))}
    />
  );
}
