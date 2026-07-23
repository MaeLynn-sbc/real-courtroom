"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { scheduleMaintenanceAction } from "@/actions/court.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { courtMaintenanceSchema } from "@/features/courts/schemas/court.schema";

interface CourtMaintenanceFormProps {
  courtId: string;
  onScheduled?: () => void;
}

export function CourtMaintenanceForm({ courtId, onScheduled }: CourtMaintenanceFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(courtMaintenanceSchema),
    defaultValues: { reason: "", notes: undefined },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      const result = await scheduleMaintenanceAction(courtId, values);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Maintenance scheduled.");
      reset();
      onScheduled?.();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Reason</Label>
        <Input id="reason" {...register("reason")} />
        {errors.reason ? (
          <p className="text-destructive text-sm">{errors.reason.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startAt">Starts</Label>
        <Input id="startAt" type="datetime-local" {...register("startAt")} />
        {errors.startAt ? (
          <p className="text-destructive text-sm">{errors.startAt.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="endAt">Ends</Label>
        <Input id="endAt" type="datetime-local" {...register("endAt")} />
        {errors.endAt ? <p className="text-destructive text-sm">{errors.endAt.message}</p> : null}
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Scheduling…" : "Schedule maintenance"}
      </Button>
    </form>
  );
}
