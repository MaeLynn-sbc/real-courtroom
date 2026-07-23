"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/actions/role.actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmActionButton } from "@/components/shared/confirm-action-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createRoleSchema } from "@/features/roles/schemas/role.schema";
import type { roleService } from "@/services/role/role.service";

type Role = NonNullable<Awaited<ReturnType<typeof roleService.getRoleById>>>;
type Permissions = Awaited<ReturnType<typeof roleService.listPermissions>>;

interface RoleFormProps {
  role?: Role;
  permissions: Permissions;
}

export function RoleForm({ role, permissions }: RoleFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [label, setLabel] = useState(role?.label ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissionKeys, setPermissionKeys] = useState<Set<string>>(
    new Set(role?.permissions.map((rp) => rp.permission.key) ?? []),
  );

  function togglePermission(key: string, enabled: boolean) {
    setPermissionKeys((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const parsed = createRoleSchema.safeParse({
      label,
      description: description || undefined,
      permissionKeys: Array.from(permissionKeys),
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid role details.");
      return;
    }

    startTransition(async () => {
      const result = role
        ? await updateRoleAction(role.id, parsed.data)
        : await createRoleAction(parsed.data);

      if (result.error) {
        setServerError(result.error);
        return;
      }

      toast.success(role ? "Role updated." : "Role created.");
      if (!role && "roleId" in result && result.roleId) {
        router.push(`/dashboard/admin/roles?roleId=${result.roleId}`);
      }
      router.refresh();
    });
  }

  function onDelete() {
    if (!role) {
      return;
    }
    startDeleteTransition(async () => {
      const result = await deleteRoleAction(role.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Role deleted.");
      router.push("/dashboard/admin/roles");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>{role ? role.label : "New role"}</CardTitle>
          {role?.isSystem ? <Badge variant="secondary">Built-in</Badge> : null}
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="label">Role name</Label>
              <Input id="label" value={label} onChange={(event) => setLabel(event.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Permissions</Label>
              <div className="flex flex-col gap-1 rounded-lg border p-3">
                {permissions.map((permission) => (
                  <div key={permission.id} className="flex items-center justify-between gap-3 py-1">
                    <div>
                      <p className="text-sm font-medium">{permission.label}</p>
                      {permission.description ? (
                        <p className="text-muted-foreground text-xs">{permission.description}</p>
                      ) : null}
                    </div>
                    <Switch
                      checked={permissionKeys.has(permission.key)}
                      onCheckedChange={(checked) => togglePermission(permission.key, checked)}
                    />
                  </div>
                ))}
              </div>
            </div>

            {serverError ? (
              <p className="text-destructive text-sm" role="alert">
                {serverError}
              </p>
            ) : null}

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : role ? "Save changes" : "Create role"}
              </Button>
              {role && !role.isSystem ? (
                <ConfirmActionButton
                  title="Delete this role?"
                  description="Every employee must be reassigned off this role first. This can't be undone."
                  confirmLabel="Delete"
                  disabled={isDeletePending}
                  onConfirm={onDelete}
                >
                  Delete role
                </ConfirmActionButton>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
