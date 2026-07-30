"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createEquipmentAction, updateEquipmentAction } from "@/actions/equipment.actions";
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
import { Switch } from "@/components/ui/switch";
import { createEquipmentSchema } from "@/features/equipment/schemas/equipment.schema";
import type { Equipment } from "@/lib/generated/prisma/client";

const TYPE_OPTIONS = [
  { value: "PADDLE", label: "Paddle" },
  { value: "BALL", label: "Ball" },
  { value: "BALL_MACHINE", label: "Ball Machine" },
] as const;

const STATUS_OPTIONS = [
  { value: "AVAILABLE", label: "Available" },
  { value: "MAINTENANCE", label: "Maintenance (whole line pulled)" },
  { value: "RETIRED", label: "Retired" },
] as const;

interface EquipmentFormValues {
  name: string;
  type: (typeof TYPE_OPTIONS)[number]["value"];
  quantity: string;
  depositCents: string;
  rentalRateCents: string;
  status: (typeof STATUS_OPTIONS)[number]["value"];
  lowStockAlertDisabled: boolean;
}

interface EquipmentFormProps {
  equipment?: Equipment;
}

export function EquipmentForm({ equipment }: EquipmentFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, control } = useForm<EquipmentFormValues>({
    defaultValues: {
      name: equipment?.name ?? "",
      type: equipment?.type ?? "PADDLE",
      quantity: equipment ? String(equipment.quantity) : "1",
      depositCents: equipment ? String(equipment.depositCents) : "0",
      rentalRateCents: equipment ? String(equipment.rentalRateCents) : "0",
      status: (equipment?.status as (typeof STATUS_OPTIONS)[number]["value"]) ?? "AVAILABLE",
      lowStockAlertDisabled: equipment?.lowStockAlertDisabled ?? false,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createEquipmentSchema.safeParse({
      name: values.name.trim(),
      type: values.type,
      quantity: values.quantity,
      depositCents: values.depositCents,
      rentalRateCents: values.rentalRateCents,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid equipment details.");
      return;
    }

    startTransition(async () => {
      if (equipment) {
        const result = await updateEquipmentAction(equipment.id, {
          ...parsed.data,
          status: values.status,
          lowStockAlertDisabled: values.lowStockAlertDisabled,
        });
        if (result.error) {
          setServerError(result.error);
          toast.error(result.error);
          return;
        }
        toast.success("Equipment updated.");
        router.refresh();
        return;
      }

      const result = await createEquipmentAction(parsed.data);
      if (result.error || !result.equipmentId) {
        const message = result.error ?? "Something went wrong.";
        setServerError(message);
        toast.error(message);
        return;
      }
      toast.success("Equipment created.");
      router.push(`/dashboard/equipment/${result.equipmentId}`);
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. House Paddle" {...register("name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="type">Type</Label>
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
        <Label htmlFor="quantity">Quantity</Label>
        <Input id="quantity" type="number" min={1} {...register("quantity")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="depositCents">Deposit (cents)</Label>
        <Input id="depositCents" type="number" min={0} {...register("depositCents")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rentalRateCents">Rental rate (cents)</Label>
        <Input id="rentalRateCents" type="number" min={0} {...register("rentalRateCents")} />
      </div>

      {equipment ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="status">Status</Label>
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
      ) : null}

      {equipment ? (
        <div className="flex items-center gap-3">
          <Controller
            control={control}
            name="lowStockAlertDisabled"
            render={({ field }) => (
              <Switch
                id="lowStockAlertDisabled"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked)}
              />
            )}
          />
          <Label htmlFor="lowStockAlertDisabled" className="flex flex-col gap-0.5">
            <span>Don&apos;t alert on low stock for this item</span>
            <span className="text-muted-foreground text-xs font-normal">
              Use this for a small, fully-owned pool (e.g. a Ball Machine) where full availability would otherwise
              be misread as low stock.
            </span>
          </Label>
        </div>
      ) : null}

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : equipment ? "Save changes" : "Create equipment"}
      </Button>
    </form>
  );
}
