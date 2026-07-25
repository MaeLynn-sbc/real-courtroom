import type { Metadata } from "next";

import { auth } from "@/auth";
import { CoachAvailabilityManager } from "@/features/coaching/components/coach-availability-manager";
import { prisma } from "@/lib/prisma";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";

export const metadata: Metadata = {
  title: "Coaching Availability",
};

interface CoachAvailabilityPageProps {
  searchParams: Promise<{ coachId?: string }>;
}

// Part B: any employee holding coaching:manage_own_availability can view
// and edit ANY coach's calendar right now (see
// coach-availability.service.ts's ALLOW_CROSS_COACH_AVAILABILITY_EDITS
// and BUILD-SPEC.md §15 for why) — including a non-coach admin managing
// a coach's schedule on their behalf. This page needs a coach picker for
// that to actually be reachable, not just permitted at the service
// layer; defaults to "my own" when the signed-in account is itself a
// coach, since that's still the common case.
export default async function CoachAvailabilityPage({ searchParams }: CoachAvailabilityPageProps) {
  const { coachId: coachIdParam } = await searchParams;
  const session = await auth();
  const ownEmployee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  const coaches = await coachAvailabilityService.listCoaches();
  const selectedCoachId =
    coachIdParam && coaches.some((coach) => coach.id === coachIdParam)
      ? coachIdParam
      : (ownEmployee?.isCoach ? ownEmployee.id : coaches[0]?.id) ?? "";
  const isOwnCalendar = selectedCoachId === ownEmployee?.id;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Coaching availability</h1>
        <p className="text-muted-foreground text-sm">
          Open specific dates and times a coach is bookable for coaching. Nothing outside a window
          is bookable by the public — staff can still book past it with an explicit override.
        </p>
      </div>

      {coaches.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No employees are marked as a coach yet — mark one on their employee profile first.
        </p>
      ) : (
        <CoachAvailabilityManagerData
          coaches={coaches}
          selectedCoachId={selectedCoachId}
          isOwnCalendar={isOwnCalendar}
        />
      )}
    </div>
  );
}

async function CoachAvailabilityManagerData({
  coaches,
  selectedCoachId,
  isOwnCalendar,
}: {
  coaches: Awaited<ReturnType<typeof coachAvailabilityService.listCoaches>>;
  selectedCoachId: string;
  isOwnCalendar: boolean;
}) {
  const windows = selectedCoachId ? await coachAvailabilityService.listWindows(selectedCoachId) : [];
  return (
    <CoachAvailabilityManager
      coaches={coaches}
      selectedCoachId={selectedCoachId}
      isOwnCalendar={isOwnCalendar}
      windows={windows}
    />
  );
}
