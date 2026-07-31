import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
import { shiftService } from "@/services/shift/shift.service";
import { PERMISSIONS, type PermissionKey } from "@/types/permissions";

// Every actions/*.ts file independently redeclared this exact auth() +
// hasPermission() shape (confirmed identical structure across 9 files,
// differing only in the permission constant and denied-message string).
// Centralizing it means a future action can't forget the permission check
// or check it in the wrong order — auth always precedes Zod parsing here,
// same as every pre-existing call site.
export type AuthorizationResult = { ok: true; userId: string } | { ok: false; error: string };

export async function requireSession(): Promise<AuthorizationResult> {
  const session = await auth();

  if (!session?.user) {
    return { ok: false, error: "You must be signed in." };
  }

  return { ok: true, userId: session.user.id };
}

export async function requirePermission(
  permission: PermissionKey,
  deniedMessage: string,
): Promise<AuthorizationResult> {
  const session = await auth();

  if (!session?.user) {
    return { ok: false, error: "You must be signed in." };
  }

  // v1.2 defense-in-depth: middleware.ts already redirects a must-change
  // account away from every permission-gated page before it can reach the
  // form that would call this action, but that's page-load-only coverage.
  // Refusing here too means a crafted direct call to any permission-
  // checked action fails on its own, without depending on middleware.
  // requireSession() (below) is deliberately NOT gated the same way — the
  // self-service change-password action needs to keep working precisely
  // while this is true, and it only calls requireSession.
  if (session.user.mustChangePassword) {
    return { ok: false, error: "You must change your password before continuing." };
  }

  if (!hasPermission(session.user.permissions, permission)) {
    return { ok: false, error: deniedMessage };
  }

  return { ok: true, userId: session.user.id };
}

export async function requireSystemAdmin(deniedMessage: string): Promise<AuthorizationResult> {
  return requirePermission(PERMISSIONS.SYSTEM_ADMIN, deniedMessage);
}

// v1.1 Sub-phase 2: every action that creates a Sale (booking, membership
// enrollment, equipment/locker rental, tournament registration) needs both
// a permission check AND the caller's Employee + currently open Shift, since
// Sale.employeeId/shiftId are required columns — a Sale can't exist without
// an actively clocked-in employee behind it. Combines requirePermission with
// the same Employee lookup shift.actions.ts's requireOwnEmployee already
// does, plus a fresh open-shift lookup.
export type EmployeeShiftAuthorizationResult =
  | { ok: true; userId: string; employeeId: string; shiftId: string }
  | { ok: false; error: string };

export async function requireEmployeeWithOpenShift(
  permission: PermissionKey,
  deniedMessage: string,
): Promise<EmployeeShiftAuthorizationResult> {
  const authz = await requirePermission(permission, deniedMessage);
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false, error: "No employee profile is linked to this account." };
  }

  const openShift = await prisma.shift.findFirst({
    where: { employeeId: employee.id, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });
  if (!openShift) {
    return { ok: false, error: "Start a shift before recording this transaction." };
  }

  return { ok: true, userId: authz.userId, employeeId: employee.id, shiftId: openShift.id };
}

// Approving a payment verification (booking or open-play) — reported
// live: the Owner needing an open shift just to approve a GCash payment
// from home was pure friction, but unlike booking creation below,
// Sale.shiftId is a required column here (approving creates a real
// Sale immediately) — there's no such thing as "skip the shift" the way
// requireEmployeeForBookingCreation gets to, since Booking has no
// shiftId column to skip. shiftService.resolveShiftForSaleAttribution
// does the actual work: a real open shift if the approver has one
// (unchanged from requireEmployeeWithOpenShift above — correct for cash
// reconciliation), otherwise a per-employee perpetual CLOSED shift
// instead of denying (see that method's own comment for why CLOSED, not
// OPEN). "Approved by (name)" already works regardless of which shift
// this resolves to — Sale.employeeId is set independently, from the
// approver, not derived from the shift.
export async function requireEmployeeForPaymentApproval(
  permission: PermissionKey,
  deniedMessage: string,
): Promise<EmployeeShiftAuthorizationResult> {
  const authz = await requirePermission(permission, deniedMessage);
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false, error: "No employee profile is linked to this account." };
  }

  const shift = await shiftService.resolveShiftForSaleAttribution(employee.id);
  return { ok: true, userId: authz.userId, employeeId: employee.id, shiftId: shift.id };
}

// Booking CREATION only — reported live: the Owner doesn't work a cash
// drawer, so requireEmployeeWithOpenShift's blanket "must have an open
// shift" was pure friction for an action that moves no money (a staff
// booking is created unpaid; see CreateBookingSaleContext's own
// comment). shiftId is optional on success specifically because
// Booking has no shiftId column at all — createBooking only ever reads
// it from a Sale-creating branch that staff bookings never take (see
// booking.service.ts's createBooking). Deliberately its OWN function,
// not a flag on requireEmployeeWithOpenShift — every OTHER caller of
// that function (settleBooking, equipment/locker rentals, membership
// enrollment, tournament registration) creates a Sale immediately and
// must keep requiring a real shift unconditionally; this exemption is
// scoped to exactly one action.
export type EmployeeOptionalShiftAuthorizationResult =
  | { ok: true; userId: string; employeeId: string; shiftId: string | undefined }
  | { ok: false; error: string };

export async function requireEmployeeForBookingCreation(
  permission: PermissionKey,
  deniedMessage: string,
): Promise<EmployeeOptionalShiftAuthorizationResult> {
  const authz = await requirePermission(permission, deniedMessage);
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false, error: "No employee profile is linked to this account." };
  }

  const openShift = await prisma.shift.findFirst({
    where: { employeeId: employee.id, status: "OPEN" },
    orderBy: { startedAt: "desc" },
  });
  if (openShift) {
    return { ok: true, userId: authz.userId, employeeId: employee.id, shiftId: openShift.id };
  }

  const session = await auth();
  const canSkipShift = hasPermission(session?.user.permissions ?? [], PERMISSIONS.BOOKINGS_CREATE_WITHOUT_SHIFT);
  if (!canSkipShift) {
    return { ok: false, error: "Start a shift before recording this transaction." };
  }

  return { ok: true, userId: authz.userId, employeeId: employee.id, shiftId: undefined };
}

export type EmployeeAuthorizationResult =
  | { ok: true; userId: string; employeeId: string }
  | { ok: false; error: string };

// Same Employee-lookup half as requireEmployeeWithOpenShift, without the
// open-Shift requirement — for actions that need a real, attributable
// employee (no anonymous action) but don't create a Sale, so there's no
// technical reason to require a clocked-in shift (e.g. writing off a
// tab — BUILD-SPEC.md §9's "no anonymous write-offs").
export async function requireEmployee(
  permission: PermissionKey,
  deniedMessage: string,
): Promise<EmployeeAuthorizationResult> {
  const authz = await requirePermission(permission, deniedMessage);
  if (!authz.ok) {
    return authz;
  }

  const employee = await prisma.employee.findUnique({ where: { userId: authz.userId } });
  if (!employee) {
    return { ok: false, error: "No employee profile is linked to this account." };
  }

  return { ok: true, userId: authz.userId, employeeId: employee.id };
}
