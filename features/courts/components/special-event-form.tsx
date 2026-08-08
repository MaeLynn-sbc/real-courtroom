"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { scheduleSpecialEventAction } from "@/actions/court.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { specialEventSchema } from "@/features/courts/schemas/court.schema";

interface SpecialEventFormCourt {
  id: string;
  name: string;
}

interface SpecialEventFormProps {
  courts: SpecialEventFormCourt[];
}

export function SpecialEventForm({ courts }: SpecialEventFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(specialEventSchema),
    defaultValues: { reason: "", notes: undefined, courtIds: [] as string[] },
  });

  function toggleCourt(courtId: string, checked: boolean) {
    setCourtIds((current) =>
      checked ? [...current, courtId] : current.filter((id) => id !== courtId),
    );
  }

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    if (courtIds.length === 0) {
      setServerError("Select at least one court.");
      return;
    }

    startTransition(async () => {
      const result = await scheduleSpecialEventAction({ ...values, courtIds });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success(`Blocked ${courtIds.length} court${courtIds.length === 1 ? "" : "s"} for the event.`);
      reset();
      setCourtIds([]);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="reason">Event name</Label>
        <Input id="reason" placeholder="e.g. Private tournament" {...register("reason")} />
        {errors.reason ? <p className="text-destructive text-sm">{errors.reason.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Courts</Label>
        <div className="flex flex-col gap-2 rounded-lg border p-3">
          {courts.map((court) => (
            <div key={court.id} className="flex items-center justify-between gap-3">
              <Label htmlFor={`court-${court.id}`} className="font-normal">
                {court.name}
              </Label>
              <Switch
                id={`court-${court.id}`}
                checked={courtIds.includes(court.id)}
                onCheckedChange={(checked) => toggleCourt(court.id, checked)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startAt">Starts</Label>
        <Input id="startAt" type="datetime-local" {...register("startAt")} />
        {errors.startAt ? <p className="text-destructive text-sm">{errors.startAt.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="endAt">Ends</Label>
        <Input id="endAt" type="datetime-local" {...register("endAt")} />
        {errors.endAt ? <p className="text-destructive text-sm">{errors.endAt.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="notes">Notes (internal, not shown publicly)</Label>
        <Textarea id="notes" rows={3} {...register("notes")} />
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Blocking…" : "Block courts for this event"}
      </Button>
    </form>
  );
}
