"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createEmployeeAction } from "@/actions/employee.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TempPasswordReveal } from "@/features/employees/components/temp-password-reveal";
import { createEmployeeSchema } from "@/features/employees/schemas/employee.schema";

interface RoleOption {
  id: string;
  label: string;
}

interface EmployeeCreateFormProps {
  roles: RoleOption[];
}

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  username: "",
  phone: "",
  email: "",
  roleId: "",
};

export function EmployeeCreateForm({ roles }: EmployeeCreateFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState(EMPTY_FORM);
  // Holds { tempPassword, employeeId } between a successful create and the
  // admin dismissing the reveal — navigation is deferred until then so the
  // password stays on screen instead of getting swept away by the redirect.
  const [pendingReveal, setPendingReveal] = useState<{ tempPassword: string; employeeId: string } | null>(
    null,
  );

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const parsed = createEmployeeSchema.safeParse({
      firstName: values.firstName,
      lastName: values.lastName,
      username: values.username,
      phone: values.phone || undefined,
      email: values.email || undefined,
      roleId: values.roleId,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid employee details.");
      return;
    }

    startTransition(async () => {
      const result = await createEmployeeAction(parsed.data);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Employee created.");
      setValues(EMPTY_FORM);
      if (result.employeeId && result.tempPassword) {
        setPendingReveal({ employeeId: result.employeeId, tempPassword: result.tempPassword });
      }
    });
  }

  if (pendingReveal) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>New employee</CardTitle>
        </CardHeader>
        <CardContent>
          <TempPasswordReveal
            password={pendingReveal.tempPassword}
            onDismiss={() => {
              router.push(`/dashboard/admin/employees?employeeId=${pendingReveal.employeeId}`);
              router.refresh();
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New employee</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="firstName">First name</Label>
              <Input
                id="firstName"
                value={values.firstName}
                onChange={(event) => setField("firstName", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lastName">Last name</Label>
              <Input
                id="lastName"
                value={values.lastName}
                onChange={(event) => setField("lastName", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="off"
              value={values.username}
              onChange={(event) => setField("username", event.target.value)}
            />
            <p className="text-muted-foreground text-xs">
              A temporary password is generated on creation — shown once, next step.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input
                id="phone"
                value={values.phone}
                onChange={(event) => setField("phone", event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email (optional)</Label>
              <Input
                id="email"
                type="email"
                value={values.email}
                onChange={(event) => setField("email", event.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="roleId">Role</Label>
            <Select value={values.roleId} onValueChange={(value) => setField("roleId", value ?? "")}>
              <SelectTrigger id="roleId" className="w-full">
                <SelectValue placeholder="Select a role">
                  {(value: string) => roles.find((role) => role.id === value)?.label ?? "Select a role"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {roles.map((role) => (
                  <SelectItem key={role.id} value={role.id}>
                    {role.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {serverError ? (
            <p className="text-destructive text-sm" role="alert">
              {serverError}
            </p>
          ) : null}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Creating…" : "Create employee"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
