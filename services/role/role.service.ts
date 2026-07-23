import type { CreateRoleInput, UpdateRoleInput } from "@/features/roles/schemas/role.schema";
import type { Prisma } from "@/lib/generated/prisma/client";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

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

// Derives the stable internal `name` key from a human-typed label —
// "Marketing" -> "MARKETING", "Front Desk Lead" -> "FRONT_DESK_LEAD". A
// collision surfaces as a normal P2002 unique-constraint error, handled by
// the existing toActionError path same as any other unique field.
function slugifyRoleName(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const roleWithPermissions = {
  permissions: { include: { permission: true } },
} satisfies Prisma.RoleInclude;

export class RoleService {
  async listRoles() {
    return prisma.role.findMany({
      include: roleWithPermissions,
      orderBy: { label: "asc" },
    });
  }

  async getRoleById(roleId: string) {
    return prisma.role.findUnique({
      where: { id: roleId },
      include: roleWithPermissions,
    });
  }

  // The fixed permission catalog — every role picks a subset of this, but
  // the catalog itself is code-defined (a new permission key wouldn't be
  // checked by any route/action, so there's no admin UI to invent one).
  async listPermissions() {
    return prisma.permission.findMany({ orderBy: { label: "asc" } });
  }

  async createRole(input: CreateRoleInput, actorUserId: string) {
    const name = slugifyRoleName(input.label);

    const role = await prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          name,
          label: input.label,
          description: input.description,
          isSystem: false,
        },
      });

      if (input.permissionKeys.length > 0) {
        const permissions = await tx.permission.findMany({
          where: { key: { in: input.permissionKeys } },
        });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId: created.id, permissionId: permission.id })),
        });
      }

      return tx.role.findUniqueOrThrow({ where: { id: created.id }, include: roleWithPermissions });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "role.created",
      entityType: "Role",
      entityId: role.id,
      newValues: role,
    });

    return role;
  }

  // Label/description/permission set are all editable, including for
  // system roles — that's the point of making roles permission-based
  // instead of hardcoded. Only the stable `name` key and deletion are
  // blocked for system roles (see deleteRole), since some code paths
  // still look a role up by that name.
  async updateRole(roleId: string, input: UpdateRoleInput, actorUserId: string) {
    const existing = await prisma.role.findUniqueOrThrow({
      where: { id: roleId },
      include: roleWithPermissions,
    });

    const role = await prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id: roleId },
        data: { label: input.label, description: input.description },
      });

      await tx.rolePermission.deleteMany({ where: { roleId } });

      if (input.permissionKeys.length > 0) {
        const permissions = await tx.permission.findMany({
          where: { key: { in: input.permissionKeys } },
        });
        await tx.rolePermission.createMany({
          data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
        });
      }

      return tx.role.findUniqueOrThrow({ where: { id: roleId }, include: roleWithPermissions });
    });

    await this.writeAuditLog({
      actorUserId,
      action: "role.updated",
      entityType: "Role",
      entityId: role.id,
      oldValues: existing,
      newValues: role,
    });

    return role;
  }

  async deleteRole(roleId: string, actorUserId: string) {
    const role = await prisma.role.findUniqueOrThrow({ where: { id: roleId } });

    if (role.isSystem) {
      throw new Error("Built-in roles can't be deleted.");
    }

    const usersWithRole = await prisma.user.count({ where: { roleId } });
    if (usersWithRole > 0) {
      throw new Error("Reassign every employee off this role before deleting it.");
    }

    await prisma.role.delete({ where: { id: roleId } });

    await this.writeAuditLog({
      actorUserId,
      action: "role.deleted",
      entityType: "Role",
      entityId: roleId,
      oldValues: role,
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

export const roleService = new RoleService();
