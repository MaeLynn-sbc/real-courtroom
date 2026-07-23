"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createTournamentAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTournamentSchema } from "@/features/tournaments/schemas/tournament.schema";

interface TournamentFormValues {
  name: string;
  description: string;
  venueInfo: string;
  startDate: string;
  endDate: string;
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
    formState: { errors },
  } = useForm<TournamentFormValues>({
    defaultValues: {
      name: "",
      description: "",
      venueInfo: "",
      startDate: toLocalDateValue(new Date()),
      endDate: toLocalDateValue(new Date()),
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

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create tournament"}
      </Button>
    </form>
  );
}
