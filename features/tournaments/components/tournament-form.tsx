"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createTournamentAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createTournamentSchema } from "@/features/tournaments/schemas/tournament.schema";

interface TournamentFormValues {
  name: string;
  description: string;
  venueInfo: string;
  startDate: string;
  endDate: string;
  collectsPaymentOnSite: boolean;
}

function toLocalDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function TournamentForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<TournamentFormValues>({
    defaultValues: {
      name: "",
      description: "",
      venueInfo: "",
      startDate: toLocalDateValue(new Date()),
      endDate: toLocalDateValue(new Date()),
      collectsPaymentOnSite: true,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createTournamentSchema.safeParse({
      name: values.name.trim(),
      description: values.description.trim() || undefined,
      venueInfo: values.venueInfo.trim() || undefined,
      startDate: new Date(`${values.startDate}T00:00:00`),
      endDate: new Date(`${values.endDate}T00:00:00`),
      collectsPaymentOnSite: values.collectsPaymentOnSite,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid tournament details.");
      return;
    }

    startTransition(async () => {
      const result = await createTournamentAction(parsed.data);
      if (result.error || !result.tournamentId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Tournament created.");
      router.push(`/dashboard/tournaments/${result.tournamentId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Summer Slam 2026" {...register("name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venueInfo">Venue (optional)</Label>
        <Input id="venueInfo" {...register("venueInfo")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startDate">Start date</Label>
        <Input id="startDate" type="date" {...register("startDate")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="endDate">End date</Label>
        <Input id="endDate" type="date" {...register("endDate")} />
        {errors.endDate ? <p className="text-destructive text-sm">{errors.endDate.message}</p> : null}
      </div>

      {/* Owner request (2026-08-05): unchecked for an outside event where
          entrants already paid the organizers directly — registering a
          team then won't require an open shift or record a Sale. */}
      <div className="flex items-center gap-2">
        <Controller
          control={control}
          name="collectsPaymentOnSite"
          render={({ field }) => (
            <Switch
              id="collectsPaymentOnSite"
              checked={field.value}
              onCheckedChange={field.onChange}
              aria-label="Collect payment when registering teams"
            />
          )}
        />
        <Label htmlFor="collectsPaymentOnSite" className="font-normal">
          Collect payment here when registering teams
        </Label>
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create tournament"}
      </Button>
    </form>
  );
}
