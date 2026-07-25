import type { Metadata } from "next";

import { CoachRateManager } from "@/features/coaching/components/coach-rate-manager";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachRateService } from "@/services/coaching/coach-rate.service";

export const metadata: Metadata = {
  title: "Coaching Rates",
};

interface CoachRatesPageProps {
  searchParams: Promise<{ coachId?: string }>;
}

export default async function CoachRatesPage({ searchParams }: CoachRatesPageProps) {
  const { coachId } = await searchParams;
  const coaches = await coachAvailabilityService.listCoaches();
  const selectedCoachId = coachId && coaches.some((coach) => coach.id === coachId) ? coachId : (coaches[0]?.id ?? "");
  const rates = selectedCoachId ? await coachRateService.listRates(selectedCoachId) : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coaching rates</h1>
        <p className="text-muted-foreground text-sm">
          Group size determines price, per coach. Editing a rate never rewrites a session that
          already booked at the old price.
        </p>
      </div>

      {coaches.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No employees are marked as a coach yet — mark one on their employee profile first.
        </p>
      ) : (
        <CoachRateManager coaches={coaches} selectedCoachId={selectedCoachId} rates={rates} />
      )}
    </div>
  );
}
