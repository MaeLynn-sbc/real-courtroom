"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createEquipmentRentalAction } from "@/actions/equipment.actions";
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
import { createEquipmentRentalSchema } from "@/features/equipment/schemas/equipment.schema";

interface RentalFormPlayer {
  id: string;
  label: string;
}

interface RentalFormPaymentMethod {
  id: string;
  label: string;
}

interface EquipmentRentalFormValues {
  playerId: string;
  dueAt: string;
  paymentMethodId: string;
}

interface EquipmentRentalFormProps {
  equipmentId: string;
  players: RentalFormPlayer[];
  paymentMethods: RentalFormPaymentMethod[];
}

export function EquipmentRentalForm({ equipmentId, players, paymentMethods }: EquipmentRentalFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { handleSubmit, control, register, reset } = useForm<EquipmentRentalFormValues>({
    defaultValues: {
      playerId: players[0]?.id ?? "",
      dueAt: "",
      paymentMethodId: paymentMethods[0]?.id ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createEquipmentRentalSchema.safeParse({
      playerId: values.playerId,
      dueAt: values.dueAt ? new Date(`${values.dueAt}T00:00:00`) : undefined,
      paymentMethodId: values.paymentMethodId,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid rental details.");
      return;
    }

    startTransition(async () => {
      const result = await createEquipmentRentalAction(equipmentId, parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Equipment rented out.");
      reset({ playerId: values.playerId, dueAt: "", paymentMethodId: values.paymentMethodId });
      router.refresh();
    });
  });

  if (players.length === 0) {
    return <p className="text-muted-foreground text-sm">No players to rent to yet.</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rentalPlayerId">Player</Label>
        <Controller
          control={control}
          name="playerId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="rentalPlayerId" className="w-full">
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
        <Label htmlFor="dueAt">Due date (optional)</Label>
        <Input id="dueAt" type="date" {...register("dueAt")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rentalPaymentMethodId">Payment method</Label>
        <Controller
          control={control}
          name="paymentMethodId"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="rentalPaymentMethodId" className="w-full">
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
