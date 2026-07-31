import bcrypt from "bcryptjs";

import type {
  ChangeRoleInput,
  CreateEmployeeInput,
  SetActiveInput,
  SetCoachInput,
  UpdateEmployeeInput,
} from "@/features/employees/schemas/employee.schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { nextSequence } from "@/lib/reference-counter";
import { generateTempPassword } from "@/lib/temp-password";
import { formatEmployeeNumber } from "@/services/employee/employee-number";

// Same cost factor as prisma/seed.ts's Owner password hash.
const PASSWORD_HASH_COST = 12;

function toJsonValue(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

interface AuditLogEntry {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValues?: unknown;
  newValues?: unknown;
}

const employeeWithUser = {
  user: { select: { id: true, name: true, email: true, username: true, role: true } },
} satisfies Prisma.EmployeeInclude;

export class EmployeeService {
  async listEmployees() {
    return prisma.employee.findMany({
      where: { deletedAt: null },
      include: employeeWithUser,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      take: 200,
    });
  }

  async getEmployeeById(employeeId: string) {
    return prisma.employee.findUnique({
      where: { id: employeeId },
      include: employeeWithUser,
    });
  }

  // Creates a User + Employee pair in one transaction — the exact
  // precedent playerService.createPlayer already set. v1.1 maintenance:
  // the employee number comes from the shared atomic counter
  // (lib/reference-counter.ts), generated inside this same transaction —
  // it can no longer collide, so no retry loop is needed.
  //
  // v1.2: the password is system-generated, never admin-chosen (see
  // lib/temp-password.ts) — returned as plaintext ONLY in this method's
  // return value, for the caller to show the admin exactly once. Nothing
  // persists it in plaintext; only its bcrypt hash reaches the database.
  // mustChangePassword starts true, forcing the new employee through the
  // change-password flow before anything else (lib/rbac.ts,
  // lib/action-auth.ts).
  async createEmployee(input: CreateEmployeeInput, actorUserId: string) {
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, PASSWORD_HASH_COST);
    const name = `${input.firstName} ${input.lastName}`.trim();
    const now = new Date();

    const employee = await prisma.$transaction(async (tx) => {
      const sequence = await nextSequence("EMPLOYEE", tx);
      const employeeNumber = formatEmployeeNumber(sequence);

      const user = await tx.user.create({
        data: {
          name,
          email: input.email,
          username: input.username.toLowerCase(),
          passwordHash,
          mustChangePassword: true,
          passwordChangedAt: now,
          roleId: input.roleId,
        },
      });

      return tx.employee.create({
        data: {
          userId: user.id,
          employeeNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          photoUrl: input.photoUrl,
          bio: input.bio,
        },
        include: employeeWithUser,
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "employee.created",
      entityType: "Employee",
      entityId: employee.id,
      newValues: employee,
    });

    return { employee, tempPassword };
  }

  async updateEmployee(employeeId: string, input: UpdateEmployeeInput, actorUserId: string) {
    const existing = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const name = `${input.firstName} ${input.lastName}`.trim();

    const employee = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.userId },
        data: { name, email: input.email },
      });

      return tx.employee.update({
        where: { id: employeeId },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          photoUrl: input.photoUrl,
          bio: input.bio,
        },
        include: employeeWithUser,
      });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "employee.updated",
      entityType: "Employee",
      entityId: employee.id,
      oldValues: existing,
      newValues: employee,
    });

    return employee;
  }

  // Same system-generated-only rule as createEmployee — an admin reset
  // never lets the admin pick the new password, and it forces the same
  // mustChangePassword flow the employee went through at creation.
  // passwordChangedAt bumping to now() is also what invalidates that
  // employee's other active sessions (see auth.ts's jwt() callback).
  async resetPassword(employeeId: string, actorUserId: string) {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    const tempPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(tempPassword, PASSWORD_HASH_COST);

    await prisma.user.update({
      where: { id: employee.userId },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "employee.password_reset",
      entityType: "Employee",
      entityId: employee.id,
    });

    return { employee, tempPassword };
  }

  async changeRole(employeeId: string, input: ChangeRoleInput, actorUserId: string) {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    await prisma.user.update({
      where: { id: employee.userId },
      data: { roleId: input.roleId },
    });

    await this.writeAuditLog({
      actorUserId,
      action: "employee.role_changed",
      entityType: "Employee",
      entityId: employee.id,
      newValues: { roleId: input.roleId },
    });

    return prisma.employee.findUniqueOrThrow({ where: { id: employeeId }, include: employeeWithUser });
  }

  async setActive(employeeId: string, input: SetActiveInput, actorUserId: string) {
    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: { isActive: input.isActive },
      include: employeeWithUser,
    });

    await this.writeAuditLog({
      actorUserId,
      action: input.isActive ? "employee.activated" : "employee.deactivated",
      entityType: "Employee",
      entityId: employee.id,
    });

    return employee;
  }

  async setCoach(employeeId: string, input: SetCoachInput, actorUserId: string) {
    const employee = await prisma.employee.update({
      where: { id: employeeId },
      data: { isCoach: input.isCoach },
      include: employeeWithUser,
    });

    await this.writeAuditLog({
      actorUserId,
      action: input.isCoach ? "employee.marked_coach" : "employee.unmarked_coach",
      entityType: "Employee",
      entityId: employee.id,
    });

    return employee;
  }

  // Login history — reads the same AuditLog rows auth.ts's authorize()
  // writes on every login attempt (success and failure).
  async getLoginHistory(employeeId: string) {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

    return prisma.auditLog.findMany({
      where: {
        entityType: "User",
        entityId: employee.userId,
        action: { in: ["auth.login_succeeded", "auth.login_failed"] },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  private async writeAuditLog(entry: AuditLogEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: entry.actorUserId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          oldValues: toJsonValue(entry.oldValues),
          newValues: toJsonValue(entry.newValues),
        },
      });
    } catch (error) {
      logger.error(
        { err: error, action: entry.action, userId: entry.actorUserId },
        "Failed to write audit log entry",
      );
    }
  }
}

export const employeeService = new EmployeeService();
