import type { Metadata } from "next";

import { RoleForm } from "@/features/roles/components/role-form";
import { RoleListPanel } from "@/features/roles/components/role-list-panel";
import { roleService } from "@/services/role/role.service";

export const metadata: Metadata = {
  title: "Roles",
};

interface RolesPageProps {
  searchParams: Promise<{ roleId?: string }>;
}

export default async function RolesPage({ searchParams }: RolesPageProps) {
  const { roleId } = await searchParams;

  const [roles, permissions] = await Promise.all([roleService.listRoles(), roleService.listPermissions()]);

  const selectedRole = roleId && roleId !== "new" ? await roleService.getRoleById(roleId) : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Roles</h1>
        <p className="text-muted-foreground text-sm">
          Create roles and choose exactly what each one can do — no code change needed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        <RoleListPanel roles={roles} selectedRoleId={roleId} />

        {roleId === "new" ? (
          <RoleForm permissions={permissions} />
        ) : selectedRole ? (
          <RoleForm role={selectedRole} permissions={permissions} />
        ) : (
          <p className="text-muted-foreground text-sm">Select a role from the list, or create a new one.</p>
        )}
      </div>
    </div>
  );
}
