"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createSessionAction } from "@/actions/open-play.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createOpenPlaySessionSchema } from "@/features/open-play/schemas/open-play.schema";

interface SessionFormValues {
  title: string;
  startAt: string;
  endAt: string;
  capacity: number;
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function SessionForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SessionFormValues>({
    defaultValues: {
      title: "",
      startAt: toLocalInputValue(new Date()),
      endAt: toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)),
      capacity: 16,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createOpenPlaySessionSchema.safeParse({
      title: values.title.trim() || undefined,
      startAt: new Date(values.startAt),
      endAt: new Date(values.endAt),
      capacity: values.capacity,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid session details.");
      return;
    }

    startTransition(async () => {
      const result = await createSessionAction(parsed.data);
      if (result.error || !result.sessionId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Open Play session created.");
      router.push(`/dashboard/open-play/${result.sessionId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title (optional)</Label>
        <Input id="title" placeholder="e.g. Saturday Open Play" {...register("title")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="startAt">Starts</Label>
        <Input id="startAt" type="datetime-local" {...register("startAt")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="endAt">Ends</Label>
        <Input id="endAt" type="datetime-local" {...register("endAt")} />
        {errors.endAt ? <p className="text-destructive text-sm">{errors.endAt.message}</p> : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="capacity">Capacity</Label>
        <Input
          id="capacity"
          type="number"
          min={1}
          {...register("capacity", { valueAsNumber: true })}
        />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create session"}
      </Button>
    </form>
  );
}
