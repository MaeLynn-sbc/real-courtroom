import type { Metadata } from "next";

import { auth } from "@/auth";
import { CoachAvailabilityManager } from "@/features/coaching/components/coach-availability-manager";
import { prisma } from "@/lib/prisma";
import { coachAvailabilityService } from "@/services/coaching/coach-availability.service";

export const metadata: Metadata = {
  title: "My Coaching Availability",
};

export default async function CoachAvailabilityPage() {
  const session = await auth();
  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My coaching availability</h1>
        <p className="text-muted-foreground text-sm">
          Open specific dates and times you&apos;re bookable for coaching. Nothing outside a window
          is bookable by the public — staff can still book past it with an explicit override.
        </p>
      </div>

      {!employee ? (
        <p className="text-muted-foreground text-sm">
          No employee profile is linked to this account.
        </p>
      ) : !employee.isCoach ? (
        <p className="text-muted-foreground text-sm">
          Your account isn&apos;t marked as a coach, so you have no availability to manage.
        </p>
      ) : (
        <CoachAvailabilityManagerData employeeId={employee.id} />
      )}
    </div>
  );
}

async function CoachAvailabilityManagerData({ employeeId }: { employeeId: string }) {
  const windows = await coachAvailabilityService.listWindows(employeeId);
  return <CoachAvailabilityManager coachId={employeeId} windows={windows} />;
}
