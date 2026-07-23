"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createLockerRentalAction } from "@/actions/locker.actions";
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
import { createLockerRentalSchema } from "@/features/lockers/schemas/locker.schema";

const TYPE_OPTIONS = [
  { value: "DAILY", label: "Daily" },
  { value: "MONTHLY", label: "Monthly" },
] as const;

interface RentalFormPlayer {
  id: string;
  label: string;
}

interface RentalFormPaymentMethod {
  id: string;
  label: string;
}

interface LockerRentalFormValues {
  playerId: string;
  type: (typeof TYPE_OPTIONS)[number]["value"];
  startAt: string;
  endAt: string;
  paymentMethodId: string;
}

interface LockerRentalFormProps {
  lockerId: string;
  players: RentalFormPlayer[];
  paymentMethods: RentalFormPaymentMethod[];
}

function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function LockerRentalForm({ lockerId, players, paymentMethods }: LockerRentalFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { handleSubmit, control, register, reset } = useForm<LockerRentalFormValues>({
    defaultValues: {
      playerId: players[0]?.id ?? "",
      type: "DAILY",
      startAt: toLocalInputValue(new Date()),
      endAt: toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)),
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createLockerRentalSchema.safeParse({
      playerId: values.playerId,
      type: values.type,
      startAt: new Date(values.startAt),
      endAt: new Date(values.endAt),
      paymentMethodId: values.paymentMethodId,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid rental details.");
      return;
    }

    startTransition(async () => {
      const result = await createLockerRentalAction(lockerId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Locker rented out.");
      reset(values);
      router.refresh();
    });
  });

  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No players to rent to yet.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lockerRentalPlayerId">Player</Label>
        <Controller
          control={control}
          name="playerId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="lockerRentalPlayerId" className="w-full">
                <SelectValue placeholder="Select a player">
                  {(value: string) => players.find((player) => player.id === value)?.label ?? "Select a player"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
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
        <Label htmlFor="type">Rental type</Label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="type" className="w-full">
                <SelectValue>
                  {(value: string) => TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((option) => (
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
        <Label htmlFor="startAt">Starts</Label>
        <Input id="startAt" type="datetime-local" {...register("startAt")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="endAt">Ends</Label>
        <Input id="endAt" type="datetime-local" {...register("endAt")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="lockerRentalPaymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="lockerRentalPaymentMethodId" className="w-full">
                <SelectValue placeholder="Select a payment method">
                  {(value: string) =>
                    paymentMethods.find((method) => method.id === value)?.label ??
                    "Select a payment method"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((method) => (
                  <SelectItem key={method.id} value={method.id}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending} size="sm">
        {isPending ? "Renting…" : "Rent out"}
      </Button>
    </form>
  );
}
