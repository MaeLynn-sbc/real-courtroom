"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createLockerAction, updateLockerAction } from "@/actions/locker.actions";
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
import { createLockerSchema } from "@/features/lockers/schemas/locker.schema";
import type { Locker } from "@/lib/generated/prisma/client";

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "DISABLED", label: "Disabled" },
] as const;

interface LockerFormValues {
  code: string;
  status: (typeof STATUS_OPTIONS)[number]["value"];
}

interface LockerFormProps {
  locker?: Locker;
}

export function LockerForm({ locker }: LockerFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, control } = useForm<LockerFormValues>({
    defaultValues: {
      code: locker?.code ?? "",
      status: (locker?.status as (typeof STATUS_OPTIONS)[number]["value"]) ?? "AVAILABLE",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createLockerSchema.safeParse({ code: values.code.trim() });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid locker details.");
      return;
    }

    startTransition(async () => {
      if (locker) {
        const result = await updateLockerAction(locker.id, { ...parsed.data, status: values.status });
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Locker updated.");
        router.refresh();
        return;
      }

      const result = await createLockerAction(parsed.data);
      if (result.error || !result.lockerId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Locker created.");
      router.push(`/dashboard/lockers/${result.lockerId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="code">Code</Label>
        <Input id="code" placeholder="e.g. L-21" {...register("code")} />
      </div>

      {locker ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      ) : null}

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : locker ? "Save changes" : "Create locker"}
      </Button>
    </form>
  );
}
