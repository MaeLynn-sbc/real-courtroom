"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createCourtAction, updateCourtAction } from "@/actions/court.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCourtSchema } from "@/features/courts/schemas/court.schema";
import type { Court } from "@/lib/generated/prisma/client";

const DEFAULT_HOURLY_RATE_CENTS = 40000;

interface CourtFormProps {
  court?: Court;
}

export function CourtForm({ court }: CourtFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(createCourtSchema),
    defaultValues: {
      name: court?.name ?? "",
      description: court?.description ?? undefined,
      indoor: court?.indoor ?? true,
      hourlyRateCents: court?.hourlyRateCents ?? DEFAULT_HOURLY_RATE_CENTS,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    startTransition(async () => {
      if (court) {
        const result = await updateCourtAction(court.id, values);
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Court updated.");
        router.refresh();
        return;
      }

      const result = await createCourtAction(values);
      if (result.error || !result.courtId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Court created.");
      router.push(`/dashboard/courts/${result.courtId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
        {errors.name ? <p className="text-destructive text-sm">{errors.name.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={3} {...register("description")} />
        {errors.description ? (
          <p className="text-destructive text-sm">{errors.description.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hourlyRateCents">Hourly rate (cents)</Label>
        <Input
          id="hourlyRateCents"
          type="number"
          min={0}
          step={1}
          {...register("hourlyRateCents")}
        />
        {errors.hourlyRateCents ? (
          <p className="text-destructive text-sm">{errors.hourlyRateCents.message}</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="indoor"
          render={({ field }) => (
            <Switch
              id="indoor"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked)}
            />
          )}
        />
        <Label htmlFor="indoor">Indoor court</Label>
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : court ? "Save changes" : "Create court"}
      </Button>
    </form>
  );
}
