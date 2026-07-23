import type { Metadata } from "next";

import { auth } from "@/auth";
import { ShiftWorkspace } from "@/features/shifts/components/shift-workspace";
import { prisma } from "@/lib/prisma";
import { shiftService } from "@/services/shift/shift.service";

export const metadata: Metadata = {
  title: "Shift",
};

export default async function ShiftPage() {
  const session = await auth();
  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Shift</h1>
        <p className="text-muted-foreground text-sm">
          Clock in at the start of your shift and clock out at the end — everything you need is on
          this one screen.
        </p>
      </div>

      {employee ? (
        <ShiftWorkspaceData employeeId={employee.id} />
      ) : (
        <p className="text-muted-foreground text-sm">
          No employee profile is linked to this account, so shifts aren&apos;t available.
        </p>
      )}
    </div>
  );
}

async function ShiftWorkspaceData({ employeeId }: { employeeId: string }) {
  const [currentShift, recentShifts] = await Promise.all([
    shiftService.getCurrentShift(employeeId),
    shiftService.listShifts(employeeId, 10),
  ]);

  return <ShiftWorkspace currentShift={currentShift} recentShifts={recentShifts} />;
}
