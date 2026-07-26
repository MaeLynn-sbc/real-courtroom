"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  changeEmployeeRoleAction,
  resetEmployeePasswordAction,
  setEmployeeActiveAction,
  setEmployeeCoachAction,
  updateEmployeeAction,
} from "@/actions/employee.actions";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { TempPasswordReveal } from "@/features/employees/components/temp-password-reveal";
import { updateEmployeeSchema } from "@/features/employees/schemas/employee.schema";
import type { AuditLog } from "@/lib/generated/prisma/client";
import { formatAuditLogLabel } from "@/services/notifications/notification-reference";
import type { employeeService } from "@/services/employee/employee.service";

type Employee = NonNullable<Awaited<ReturnType<typeof employeeService.getEmployeeById>>>;

interface RoleOption {
  id: string;
  label: string;
}

interface EmployeeDetailPanelProps {
  employee: Employee;
  roles: RoleOption[];
  loginHistory: AuditLog[];
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" });

function ProfileSection({ employee }: { employee: Employee }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState({
    firstName: employee.firstName,
    lastName: employee.lastName,
    phone: employee.phone ?? "",
    email: employee.user.email ?? "",
    photoUrl: employee.photoUrl ?? "",
  });

  function setField<K extends keyof typeof values>(key: K, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setServerError(null);

    const parsed = updateEmployeeSchema.safeParse({
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone || undefined,
      email: values.email || undefined,
      photoUrl: values.photoUrl || undefined,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid employee details.");
      return;
    }

    startTransition(async () => {
      const result = await updateEmployeeAction(employee.id, parsed.data);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      toast.success("Profile updated.");
      router.refresh();
    });
  }

  return (
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
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" value={values.phone} onChange={(event) => setField("phone", event.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={values.email}
            onChange={(event) => setField("email", event.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="photoUrl">Photo URL</Label>
        <Input
          id="photoUrl"
          value={values.photoUrl}
          onChange={(event) => setField("photoUrl", event.target.value)}
        />
      </div>
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}

function RoleAndStatusSection({ employee, roles }: { employee: Employee; roles: RoleOption[] }) {
  const router = useRouter();
  const [roleError, setRoleError] = useState<string | null>(null);
  const [isRolePending, startRoleTransition] = useTransition();
  const [isActivePending, startActiveTransition] = useTransition();
  const [isCoachPending, startCoachTransition] = useTransition();

  function handleRoleChange(roleId: string) {
    setRoleError(null);
    startRoleTransition(async () => {
      const result = await changeEmployeeRoleAction(employee.id, { roleId });
      if (result.error) {
        setRoleError(result.error);
        return;
      }
      toast.success("Role updated.");
      router.refresh();
    });
  }

  function handleActiveChange(isActive: boolean) {
    startActiveTransition(async () => {
      const result = await setEmployeeActiveAction(employee.id, { isActive });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isActive ? "Employee enabled." : "Employee disabled.");
      router.refresh();
    });
  }

  function handleCoachChange(isCoach: boolean) {
    startCoachTransition(async () => {
      const result = await setEmployeeCoachAction(employee.id, { isCoach });
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(isCoach ? "Marked as a coach." : "No longer a coach.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="roleId">Role</Label>
        <Select
          value={employee.user.role.id}
          onValueChange={(value) => value && handleRoleChange(value)}
          disabled={isRolePending}
        >
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
        {roleError ? (
          <p className="text-destructive text-sm" role="alert">
            {roleError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Account status</p>
          <p className="text-muted-foreground text-xs">
            Disabling blocks this employee&apos;s next login attempt.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            checked={employee.isActive}
            onCheckedChange={handleActiveChange}
            disabled={isActivePending}
          />
          <Badge variant={employee.isActive ? "secondary" : "destructive"}>
            {employee.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Coaching</p>
          <p className="text-muted-foreground text-xs">
            Only a coach can hold availability windows and appear in the coach picker.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={employee.isCoach} onCheckedChange={handleCoachChange} disabled={isCoachPending} />
          <Badge variant={employee.isCoach ? "secondary" : "outline"}>
            {employee.isCoach ? "Coach" : "Not a coach"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordSection({ employee }: { employee: Employee }) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  function handleReset() {
    setServerError(null);
    startTransition(async () => {
      const result = await resetEmployeePasswordAction(employee.id);
      if (result.error) {
        setServerError(result.error);
        return;
      }
      if (result.tempPassword) {
        setTempPassword(result.tempPassword);
      }
      toast.success("Password reset.");
    });
  }

  if (tempPassword) {
    return <TempPasswordReveal password={tempPassword} onDismiss={() => setTempPassword(null)} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        Generates a new system password and forces a change at this employee&apos;s next login. There&apos;s
        no way to set a specific password — only a fresh, random one.
      </p>
      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}
      <Button type="button" size="sm" variant="outline" onClick={handleReset} disabled={isPending}>
        {isPending ? "Resetting…" : "Reset password"}
      </Button>
    </div>
  );
}

function LoginHistorySection({ loginHistory }: { loginHistory: AuditLog[] }) {
  if (loginHistory.length === 0) {
    return <p className="text-muted-foreground text-sm">No login attempts recorded yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {loginHistory.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 text-sm">
          <span>{formatAuditLogLabel(entry.action)}</span>
          <Badge variant={entry.action === "auth.login_succeeded" ? "secondary" : "destructive"}>
            {entry.action === "auth.login_succeeded" ? "Success" : "Failed"}
          </Badge>
          <span className="text-muted-foreground text-xs">{dateTimeFormatter.format(entry.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmployeeDetailPanel({ employee, roles, loginHistory }: EmployeeDetailPanelProps) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>
            {employee.firstName} {employee.lastName}
          </CardTitle>
          <span className="text-muted-foreground text-sm">{employee.employeeNumber}</span>
        </CardHeader>
        <CardContent>
          <ProfileSection employee={employee} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role & access</CardTitle>
        </CardHeader>
        <CardContent>
          <RoleAndStatusSection employee={employee} roles={roles} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPasswordSection employee={employee} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Login history</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginHistorySection loginHistory={loginHistory} />
        </CardContent>
      </Card>
    </div>
  );
}
