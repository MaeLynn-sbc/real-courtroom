import type { Metadata } from "next";

import { auth } from "@/auth";
import { CoachAvailabilityManager } from "@/features/coaching/components/coach-availability-manager";
import { prisma } from "@/lib/prisma";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";
import { coachSessionService } from "@/services/coaching/coach-session.service";
import { settingsService } from "@/services/settings/settings.service";

export const metadata: Metadata = {
  title: "Coaching Availability",
};

// Owner request (2026-08-03): "I don't want a dropdown for coaches — I
// want them to have their own tables. There's only 2 of them currently
// so they're not space consuming." Replaces the coachId-driven single
// picker (one CoachAvailabilityManager instance, switched via a Select +
// ?coachId= in the URL) with one instance PER coach, all rendered at
// once, each a fully independent section — its own week nav, its own
// selected day, its own optimistic-save state, since each is a genuinely
// separate mounted component (keyed by coach.id below, React gives each
// its own state automatically). Scales as a longer scrolling page if
// more coaches are ever added, the right degradation for a staff-only
// screen with a handful of coaches, not a picker that hides everyone
// but one. Cross-coach editing (Part B: any employee holding
// coaching:manage_own_availability can edit ANY coach's calendar, see
// coach-availability.service.ts's ALLOW_CROSS_COACH_AVAILABILITY_EDITS)
// stays reachable — every coach's table is just always visible now,
// nothing to pick to get there.
export default async function CoachAvailabilityPage() {
  const session = await auth();
  const ownEmployee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  const [coaches, courtHours] = await Promise.all([
    coachAvailabilityService.listCoaches(),
    settingsService.getCourtHours(),
  ]);

  const coachData = await Promise.all(
    coaches.map(async (coach) => {
      const [windows, activeSessions] = await Promise.all([
        coachAvailabilityService.listWindows(coach.id),
        coachSessionService.listActiveSessionsForCoach(coach.id),
      ]);
      return { coach, windows, activeSessions };
    }),
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
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
        coachData.map(({ coach, windows, activeSessions }) => (
          <CoachAvailabilityManager
            key={coach.id}
            coach={coach}
            isOwnCalendar={coach.id === ownEmployee?.id}
            windows={windows}
            activeSessions={activeSessions}
            courtHours={courtHours}
          />
        ))
      )}
    </div>
  );
}
