"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { logLockerMaintenanceAction } from "@/actions/locker.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { logMaintenanceSchema } from "@/features/lockers/schemas/locker.schema";

const LOG_TYPE_OPTIONS = [
  { value: "ROUTINE", label: "Routine maintenance" },
  { value: "DAMAGE_REPORT", label: "Damage report" },
  { value: "REPAIR", label: "Repair" },
  { value: "REPLACEMENT", label: "Replacement" },
] as const;

interface MaintenanceFormValues {
  logType: (typeof LOG_TYPE_OPTIONS)[number]["value"];
  note: string;
  performedAt: string;
}

function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function LockerMaintenanceForm({ lockerId }: { lockerId: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { handleSubmit, control, register, reset } = useForm<MaintenanceFormValues>({
    defaultValues: { logType: "ROUTINE", note: "", performedAt: toDateInputValue(new Date()) },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = logMaintenanceSchema.safeParse({
      logType: values.logType,
      note: values.note.trim(),
      performedAt: values.performedAt ? new Date(`${values.performedAt}T00:00:00`) : undefined,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid maintenance details.");
      return;
    }

    startTransition(async () => {
      const result = await logLockerMaintenanceAction(lockerId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Logged.");
      reset({ logType: "ROUTINE", note: "", performedAt: toDateInputValue(new Date()) });
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="logType">Maintenance type</Label>
        <Controller
          control={control}
          name="logType"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="logType" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    LOG_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LOG_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note</Label>
        <Textarea id="note" rows={3} {...register("note")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="performedAt">Performed on</Label>
        <Input id="performedAt" type="date" {...register("performedAt")} />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Logging…" : "Log entry"}
      </Button>
    </form>
  );
}
