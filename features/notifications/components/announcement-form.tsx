"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { createAnnouncementAction, updateAnnouncementAction } from "@/actions/announcement.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAnnouncementSchema } from "@/features/notifications/schemas/notification.schema";
import type { Announcement } from "@/lib/generated/prisma/client";

interface AnnouncementFormValues {
  title: string;
  body: string;
  expiresAt: string;
}

interface AnnouncementFormProps {
  announcement?: Announcement;
}

// Manual safeParse-on-submit rather than zodResolver, since expiresAt is an
// optional z.coerce.date() field — wiring zodResolver directly to a native
// date input silently blocks submission when the field is left empty (its
// value is "", not undefined, and coerce.date("") fails). See
// ARCHITECTURE.md's Phase 7 addendum, bug #14.
export function AnnouncementForm({ announcement }: AnnouncementFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit } = useForm<AnnouncementFormValues>({
    defaultValues: {
      title: announcement?.title ?? "",
      body: announcement?.body ?? "",
      expiresAt: announcement?.expiresAt ? announcement.expiresAt.toISOString().slice(0, 10) : "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createAnnouncementSchema.safeParse({
      title: values.title.trim(),
      body: values.body.trim(),
      expiresAt: values.expiresAt === "" ? undefined : values.expiresAt,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid announcement details.");
      return;
    }

    startTransition(async () => {
      if (announcement) {
        const result = await updateAnnouncementAction(announcement.id, parsed.data);
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Announcement updated.");
        router.refresh();
        return;
      }

      const result = await createAnnouncementAction(parsed.data);
      if (result.error || !result.announcementId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Announcement created.");
      router.push(`/dashboard/announcements/${result.announcementId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" placeholder="e.g. Court 3 closed for maintenance" {...register("title")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="body">Message</Label>
        <Textarea id="body" rows={5} {...register("body")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="expiresAt">Expires on (optional)</Label>
        <Input id="expiresAt" type="date" {...register("expiresAt")} />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : announcement ? "Save changes" : "Create announcement"}
      </Button>
    </form>
  );
}
