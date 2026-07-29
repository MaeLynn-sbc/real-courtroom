import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { ShiftDetail } from "@/features/shifts/components/shift-detail";
import { prisma } from "@/lib/prisma";
import { shiftService } from "@/services/shift/shift.service";

interface ShiftDetailPageProps {
  params: Promise<{ shiftId: string }>;
}

export async function generateMetadata({ params }: ShiftDetailPageProps): Promise<Metadata> {
  const { shiftId } = await params;
  const shift = await shiftService.getShiftById(shiftId);
  return { title: shift ? `Shift ${shift.shiftNumber}` : "Shift" };
}

// Self-service, same as /dashboard/shift itself: no dedicated
// permission exists for this (or needs to) — every role already holds
// DASHBOARD_ACCESS, and the actual gate is ownership, not a
// permission grant. A signed-in employee can open a shift's detail
// page only when it's their OWN closed shift; anyone else's shiftId
// (or an open one, which already has a live view on the main shift
// page) 404s rather than exposing another employee's cash count.
// Nobody — not even Owner — can view another employee's shift today;
// this page deliberately doesn't introduce that as a side effect.
export default async function ShiftDetailPage({ params }: ShiftDetailPageProps) {
  const { shiftId } = await params;
  const session = await auth();
  const employee = session?.user.id
    ? await prisma.employee.findUnique({ where: { userId: session.user.id } })
    : null;

  if (!employee) {
    notFound();
  }

  const shift = await shiftService.getShiftById(shiftId);
  if (!shift || shift.employeeId !== employee.id || shift.status !== "CLOSED") {
    notFound();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <ShiftDetail shift={shift} />
    </div>
  );
}
