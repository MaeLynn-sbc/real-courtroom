"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { registerForSessionAction } from "@/actions/open-play.actions";
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
import { registerForSessionSchema } from "@/features/open-play/schemas/open-play.schema";

const NO_PLAYER_VALUE = "__none__";

interface RegistrationFormPlayer {
  id: string;
  label: string;
}

interface RegistrationFormValues {
  playerId: string;
  guestName: string;
  guestPhone: string;
}

interface RegistrationFormProps {
  sessionId: string;
  players: RegistrationFormPlayer[];
}

export function RegistrationForm({ sessionId, players }: RegistrationFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<RegistrationFormValues>({
    defaultValues: { playerId: NO_PLAYER_VALUE, guestName: "", guestPhone: "" },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = registerForSessionSchema.safeParse({
      playerId: values.playerId === NO_PLAYER_VALUE ? undefined : values.playerId,
      guestName: values.guestName.trim() || undefined,
      guestPhone: values.guestPhone.trim() || undefined,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid registration details.");
      return;
    }

    startTransition(async () => {
      const result = await registerForSessionAction(sessionId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Registered.");
      reset();
      router.refresh();
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="playerId">Player</Label>
        <Controller
          control={control}
          name="playerId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="playerId" className="w-full">
                <SelectValue placeholder="No player — walk-in guest">
                  {(value: string) =>
                    value === NO_PLAYER_VALUE
                      ? "No player — walk-in guest"
                      : (players.find((player) => player.id === value)?.label ??
                        "No player — walk-in guest")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PLAYER_VALUE}>No player — walk-in guest</SelectItem>
                {players.map((player) => (
                  <SelectItem key={player.id} value={player.id}>
                    {player.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestName">Guest name</Label>
        <Input id="guestName" {...register("guestName")} />
        {errors.guestName ? (
          <p className="text-destructive text-sm">{errors.guestName.message}</p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="guestPhone">Guest phone</Label>
        <Input id="guestPhone" {...register("guestPhone")} />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Registering…" : "Register"}
      </Button>
    </form>
  );
}
