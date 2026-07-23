"use client";

import { Plus } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { roleService } from "@/services/role/role.service";

type Roles = Awaited<ReturnType<typeof roleService.listRoles>>;

interface RoleListPanelProps {
  roles: Roles;
  selectedRoleId?: string;
}

export function RoleListPanel({ roles, selectedRoleId }: RoleListPanelProps) {
  return (
    <div className="flex flex-col gap-3">
      <Link
        href="/dashboard/admin/roles?roleId=new"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-sm font-medium transition-colors",
          selectedRoleId === "new" ? "border-primary bg-muted" : "hover:border-primary/50 hover:bg-muted/30",
        )}
      >
        <Plus className="size-4" aria-hidden="true" />
        New role
      </Link>

      <div className="flex flex-col gap-1">
        {roles.map((role) => {
          const isActive = role.id === selectedRoleId;
          return (
            <Link
              key={role.id}
              href={`/dashboard/admin/roles?roleId=${role.id}`}
              className={cn(
                "flex flex-col rounded-lg px-3 py-2 text-sm transition-colors",
                isActive ? "bg-primary text-primary-foreground" : "hover:bg-muted/50",
              )}
            >
              <span className="flex items-center justify-between gap-2 font-medium">
                {role.label}
                {role.isSystem ? (
                  <Badge variant={isActive ? "outline" : "secondary"}>Built-in</Badge>
                ) : null}
              </span>
              <span className={cn("text-xs", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
                {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
