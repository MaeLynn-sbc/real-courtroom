"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, useTransition } from "react";
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

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Rounds up to the next 30-minute mark so the default "Starts" value is
// never in the past by the time staff actually submit the form.
function roundUpToNextHalfHour(date: Date): Date {
  const rounded = new Date(date);
  rounded.setSeconds(0, 0);
  const minutes = rounded.getMinutes();
  const add = minutes % 30 === 0 ? 30 : 30 - (minutes % 30);
  rounded.setMinutes(minutes + add);
  return rounded;
}

export function SpecialEventForm({ courts }: SpecialEventFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [courtIds, setCourtIds] = useState<string[]>([]);
  const [isPending, startTransition] = useTransition();

  // Owner report (2026-08-09): "why does it say invalid? can u make the
  // ui user friendly and includes time?" — a single datetime-local
  // input silently left "Invalid input" (the browser's own native
  // warning) whenever staff filled in the date but never touched the
  // time segment. Split into separate, clearly-labeled Date/Time pairs
  // — each with its own explicit purpose — plus sensible defaults
  // (starts rounded up to the next half hour, ends 2 hours later) so
  // the common case needs no typing at all.
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  useEffect(() => {
    const start = roundUpToNextHalfHour(new Date());
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    setStartDate(toDateInputValue(start));
    setStartTime(toTimeInputValue(start));
    setEndDate(toDateInputValue(end));
    setEndTime(toTimeInputValue(end));
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(specialEventSchema),
    defaultValues: { reason: "", notes: undefined, courtIds: [] as string[] },
  });

  useEffect(() => {
    if (startDate && startTime) {
      setValue("startAt", `${startDate}T${startTime}` as unknown as Date, { shouldValidate: true });
    }
  }, [startDate, startTime, setValue]);

  useEffect(() => {
    if (endDate && endTime) {
      setValue("endAt", `${endDate}T${endTime}` as unknown as Date, { shouldValidate: true });
    }
  }, [endDate, endTime, setValue]);

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
      const start = roundUpToNextHalfHour(new Date());
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
      setStartDate(toDateInputValue(start));
      setStartTime(toTimeInputValue(start));
      setEndDate(toDateInputValue(end));
      setEndTime(toTimeInputValue(end));
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
        <Label>Starts</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="startDate" className="text-muted-foreground text-xs font-normal">
              Date
            </Label>
            <Input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="startTime" className="text-muted-foreground text-xs font-normal">
              Time
            </Label>
            <Input
              id="startTime"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </div>
        </div>
        {errors.startAt ? <p className="text-destructive text-sm">{errors.startAt.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Ends</Label>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="endDate" className="text-muted-foreground text-xs font-normal">
              Date
            </Label>
            <Input
              id="endDate"
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="endTime" className="text-muted-foreground text-xs font-normal">
              Time
            </Label>
            <Input
              id="endTime"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </div>
        </div>
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
