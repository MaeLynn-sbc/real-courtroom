import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { ShiftDetail } from "@/features/shifts/components/shift-detail";
import { hasPermission } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { shiftService } from "@/services/shift/shift.service";
import { PERMISSIONS } from "@/types/permissions";

interface ShiftDetailPageProps {
  params: Promise<{ shiftId: string }>;
}

export async function generateMetadata({ params }: ShiftDetailPageProps): Promise<Metadata> {
  const { shiftId } = await params;
  const shift = await shiftService.getShiftById(shiftId);
  return { title: shift ? `Shift ${shift.shiftNumber}` : "Shift" };
}

// Ownership OR REPORTS_MANAGE, same permission the "All shifts" table
// on the parent page gates on (see that page's own comment) — a
// signed-in employee can open a shift's detail page when it's their
// OWN closed shift, and a REPORTS_MANAGE holder (Owner/Manager) can
// open ANY employee's closed shift, since reviewing another
// attendant's cash count is the actual reason this page exists.
// Anyone else's shiftId (or an open one, which already has a live view
// on the main shift page) 404s rather than exposing another
// employee's cash count.
export default async function ShiftDetailPage({ params }: ShiftDetailPageProps) {
  const { shiftId } = await params;
  const session = await auth();
  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  if (!employee) {
    notFound();
  }

  const canReviewAllShifts = hasPermission(session?.user.permissions ?? [], PERMISSIONS.REPORTS_MANAGE);

  const shift = await shiftService.getShiftById(shiftId);
  const isOwnShift = shift?.employeeId === employee.id;
  if (!shift || shift.status !== "CLOSED" || !(isOwnShift || canReviewAllShifts)) {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ShiftDetail shift={shift} />
    </div>
  );
}
