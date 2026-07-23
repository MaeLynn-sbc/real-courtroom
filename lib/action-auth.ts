import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hasPermission } from "@/lib/rbac";
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
