"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createPlayerAction, updatePlayerAction } from "@/actions/player.actions";
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
import { Textarea } from "@/components/ui/textarea";
import { createPlayerSchema } from "@/features/players/schemas/player.schema";
import type { Player, User } from "@/lib/generated/prisma/client";
import { OPEN_PLAY_SKILL_LEVEL_ORDER, OPEN_PLAY_SKILL_LEVELS } from "@/types/open-play-skill-levels";

const NONE_VALUE = "__none__";

const SKILL_LEVEL_OPTIONS = [
  { value: "BEGINNER", label: "Beginner" },
  { value: "INTERMEDIATE", label: "Intermediate" },
  { value: "ADVANCED", label: "Advanced" },
  { value: "PRO", label: "Pro" },
] as const;

const DOMINANT_HAND_OPTIONS = [
  { value: "LEFT", label: "Left" },
  { value: "RIGHT", label: "Right" },
  { value: "AMBIDEXTROUS", label: "Ambidextrous" },
] as const;

const POSITION_OPTIONS = [
  { value: "LEFT", label: "Left" },
  { value: "RIGHT", label: "Right" },
  { value: "BOTH", label: "Both" },
] as const;

function toDateInputValue(date: Date | null | undefined): string {
  if (!date) {
    return "";
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface PlayerFormValues {
  name: string;
  email: string;
  phone: string;
  bio: string;
  dateOfBirth: string;
  skillLevel: string | undefined;
  openPlaySkillLevel: string | undefined;
  dominantHand: string | undefined;
  position: string | undefined;
}

interface PlayerFormProps {
  player?: Player & { user: Pick<User, "id" | "name" | "email"> };
}

export function PlayerForm({ player }: PlayerFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, control } = useForm<PlayerFormValues>({
    defaultValues: {
      name: player?.user.name ?? "",
      email: player?.user.email ?? "",
      phone: player?.phone ?? "",
      bio: player?.bio ?? "",
      dateOfBirth: toDateInputValue(player?.dateOfBirth),
      skillLevel: player?.skillLevel ?? undefined,
      openPlaySkillLevel: player?.openPlaySkillLevel ?? undefined,
      dominantHand: player?.dominantHand ?? undefined,
      position: player?.position ?? undefined,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createPlayerSchema.safeParse({
      name: values.name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim() || undefined,
      bio: values.bio.trim() || undefined,
      dateOfBirth: values.dateOfBirth ? new Date(`${values.dateOfBirth}T00:00:00`) : undefined,
      skillLevel: values.skillLevel,
      openPlaySkillLevel: values.openPlaySkillLevel,
      dominantHand: values.dominantHand,
      position: values.position,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid player details.");
      return;
    }

    startTransition(async () => {
      if (player) {
        const result = await updatePlayerAction(player.id, parsed.data);
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Player updated.");
        router.refresh();
        return;
      }

      const result = await createPlayerAction(parsed.data);
      if (result.error || !result.playerId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Player created.");
      router.push(`/dashboard/players/${result.playerId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" {...register("name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" {...register("email")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" {...register("phone")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dateOfBirth">Date of birth</Label>
        <Input id="dateOfBirth" type="date" {...register("dateOfBirth")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="skillLevel">Skill level</Label>
        <Controller
          control={control}
          name="skillLevel"
          render={({ field }) => (
            <Select
              value={field.value ?? NONE_VALUE}
              onValueChange={(value) => field.onChange(value === NONE_VALUE ? undefined : value)}
            >
              <SelectTrigger id="skillLevel" className="w-full">
                <SelectValue placeholder="Not set">
                  {(value: string) =>
                    SKILL_LEVEL_OPTIONS.find((option) => option.value === value)?.label ?? "Not set"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Not set</SelectItem>
                {SKILL_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="openPlaySkillLevel">Open play skill level</Label>
        <Controller
          control={control}
          name="openPlaySkillLevel"
          render={({ field }) => (
            <Select
              value={field.value ?? NONE_VALUE}
              onValueChange={(value) => field.onChange(value === NONE_VALUE ? undefined : value)}
            >
              <SelectTrigger id="openPlaySkillLevel" className="w-full">
                <SelectValue placeholder="Not set">
                  {(value: string) =>
                    value === NONE_VALUE || !(value in OPEN_PLAY_SKILL_LEVELS)
                      ? "Not set"
                      : OPEN_PLAY_SKILL_LEVELS[value as keyof typeof OPEN_PLAY_SKILL_LEVELS].label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Not set</SelectItem>
                {OPEN_PLAY_SKILL_LEVEL_ORDER.map((level) => (
                  <SelectItem key={level} value={level}>
                    {OPEN_PLAY_SKILL_LEVELS[level].label} — {OPEN_PLAY_SKILL_LEVELS[level].description}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <p className="text-muted-foreground text-xs">
          Self-rated, for open play rotation fairness — separate from the tournament skill level above and
          prefilled into the registration form next time.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="dominantHand">Dominant hand</Label>
        <Controller
          control={control}
          name="dominantHand"
          render={({ field }) => (
            <Select
              value={field.value ?? NONE_VALUE}
              onValueChange={(value) => field.onChange(value === NONE_VALUE ? undefined : value)}
            >
              <SelectTrigger id="dominantHand" className="w-full">
                <SelectValue placeholder="Not set">
                  {(value: string) =>
                    DOMINANT_HAND_OPTIONS.find((option) => option.value === value)?.label ?? "Not set"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Not set</SelectItem>
                {DOMINANT_HAND_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="position">Preferred position</Label>
        <Controller
          control={control}
          name="position"
          render={({ field }) => (
            <Select
              value={field.value ?? NONE_VALUE}
              onValueChange={(value) => field.onChange(value === NONE_VALUE ? undefined : value)}
            >
              <SelectTrigger id="position" className="w-full">
                <SelectValue placeholder="Not set">
                  {(value: string) =>
                    POSITION_OPTIONS.find((option) => option.value === value)?.label ?? "Not set"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>Not set</SelectItem>
                {POSITION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bio">Bio</Label>
        <Textarea id="bio" rows={3} {...register("bio")} />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : player ? "Save changes" : "Create player"}
      </Button>
    </form>
  );
}
