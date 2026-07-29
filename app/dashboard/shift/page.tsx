import type { Metadata } from "next";

import { auth } from "@/auth";
import { ShiftWorkspace } from "@/features/shifts/components/shift-workspace";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { shiftService } from "@/services/shift/shift.service";
import { PERMISSIONS } from "@/types/permissions";

export const metadata: Metadata = {
  title: "Shift",
};

export default async function ShiftPage() {
  const session = await auth();
  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;
  // Owner-review follow-up: REPORTS_MANAGE ("View Reports & Analytics")
  // is the closest existing fit for "review another employee's cash
  // reconciliation" — no VIEW_SHIFTS-style permission exists, and
  // adding one wasn't asked for. Held by Owner and Manager, not
  // Receptionist/Tournament Director/Member — everyone below owner-tier
  // still only ever sees their own shift.
  const canReviewAllShifts = hasPermission(session?.user.permissions ?? [], PERMISSIONS.REPORTS_MANAGE);

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
        <ShiftWorkspaceData employeeId={employee.id} canReviewAllShifts={canReviewAllShifts} />
      ) : (
        <p className="text-muted-foreground text-sm">
          No employee profile is linked to this account, so shifts aren&apos;t available.
        </p>
      )}
    </div>
  );
}

async function ShiftWorkspaceData({
  employeeId,
  canReviewAllShifts,
}: {
  employeeId: string;
  canReviewAllShifts: boolean;
}) {
  const [currentShift, recentShifts] = await Promise.all([
    shiftService.getCurrentShift(employeeId),
    canReviewAllShifts ? shiftService.listAllShiftsForReview(20) : shiftService.listShifts(employeeId, 10),
  ]);

  // Gate 1: fetched here, not inside the client component, so "expected
  // cash" is shown to staff BEFORE they start entering their physical
  // count — a real comparison, not a number that only appears after
  // they've already committed to a total.
  const expectedCashCents = currentShift ? await shiftService.getExpectedCashForShift(currentShift) : null;

  return (
    <ShiftWorkspace
      currentShift={currentShift}
      recentShifts={recentShifts}
      expectedCashCents={expectedCashCents}
      showEmployeeColumn={canReviewAllShifts}
    />
  );
}
