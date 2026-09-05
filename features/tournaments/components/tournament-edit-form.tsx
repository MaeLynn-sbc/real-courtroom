"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { updateTournamentAction } from "@/actions/tournament.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Editing an existing tournament (owner request, 2026-09-05): "i cant see
// any option to change the date".
//
// The service (updateTournament) and the action (updateTournamentAction)
// already existed and were unreachable — the action's own comment said
// "that one has no UI". This is only the missing screen.
//
// DELIBERATELY NOT EDITABLE HERE:
//   slug    changing a public URL breaks existing links, so it keeps its
//           own dedicated action rather than being a field someone edits
//           by accident while fixing a date
//   status  moves through its own transition rules (tournament-status.ts)
//   categories / registrations   have their own screens
interface TournamentEditFormValues {
  name: string;
  description: string;
  venueInfo: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}

export function TournamentEditForm({
  tournamentId,
  initial,
}: {
  tournamentId: string;
  initial: {
    name: string;
    description: string | null;
    venueInfo: string | null;
    startDate: Date;
    endDate: Date;
  };
}) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TournamentEditFormValues>({
    defaultValues: {
      name: initial.name,
      description: initial.description ?? "",
      venueInfo: initial.venueInfo ?? "",
      startDate: toDateValue(initial.startDate),
      // Blank when the stored time is midnight — that is what an all-day
      // tournament looks like, and showing "00:00" would imply someone
      // deliberately set it.
      startTime: toTimeValue(initial.startDate),
      endDate: toDateValue(initial.endDate),
      endTime: toTimeValue(initial.endDate),
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result = await updateTournamentAction(tournamentId, {
        name: values.name.trim(),
        description: values.description.trim() || undefined,
        venueInfo: values.venueInfo.trim() || undefined,
        // Time is OPTIONAL. Blank means midnight, which is the honest
        // representation of an all-day event rather than forcing the
        // organiser to invent a start time.
        startDate: new Date(`${values.startDate}T${values.startTime || "00:00"}:00`),
        endDate: new Date(`${values.endDate}T${values.endTime || "00:00"}:00`),
        collectsPaymentOnSite: true,
      });
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Tournament updated.");
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editName">Name</Label>
        <Input id="editName" {...register("name", { required: "Enter a tournament name." })} />
        {errors.name ? <p className="text-destructive text-xs">{errors.name.message}</p> : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editStartDate">Start date</Label>
          <Input id="editStartDate" type="date" {...register("startDate", { required: true })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editStartTime">Start time (optional)</Label>
          <Input id="editStartTime" type="time" {...register("startTime")} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editEndDate">End date</Label>
          <Input id="editEndDate" type="date" {...register("endDate", { required: true })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editEndTime">End time (optional)</Label>
          <Input id="editEndTime" type="time" {...register("endTime")} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editVenueInfo">Venue</Label>
        <Input id="editVenueInfo" {...register("venueInfo")} placeholder="e.g. The Courtroom, Kalibo" />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="editDescription">Description</Label>
        <Textarea id="editDescription" rows={3} {...register("description")} />
      </div>

      {serverError ? (
        <p className="text-destructive text-sm" role="alert">
          {serverError}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function toDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Empty string for midnight, so an all-day tournament shows a blank time
// field rather than "00:00".
function toTimeValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const hours = date.getHours();
  const minutes = date.getMinutes();
  return hours === 0 && minutes === 0 ? "" : `${pad(hours)}:${pad(minutes)}`;
}
