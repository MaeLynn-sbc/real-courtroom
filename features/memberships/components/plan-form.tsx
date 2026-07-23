"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { createPlanAction } from "@/actions/membership.actions";
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
import { Textarea } from "@/components/ui/textarea";
import { createPlanSchema } from "@/features/memberships/schemas/membership.schema";

const BILLING_OPTIONS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
] as const;

interface PlanFormValues {
  name: string;
  description: string;
  priceCents: string;
  billingPeriod: (typeof BILLING_OPTIONS)[number]["value"];
  discountPercent: string;
  priorityBooking: boolean;
}

export function PlanForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { register, handleSubmit, control } = useForm<PlanFormValues>({
    defaultValues: {
      name: "",
      description: "",
      priceCents: "",
      billingPeriod: "MONTHLY",
      discountPercent: "",
      priorityBooking: false,
    },
  });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);

    const parsed = createPlanSchema.safeParse({
      name: values.name.trim(),
      description: values.description.trim() || undefined,
      priceCents: values.priceCents,
      billingPeriod: values.billingPeriod,
      discountPercent: values.discountPercent.trim() || undefined,
      priorityBooking: values.priorityBooking,
    });

    if (!parsed.success) {
      setServerError(parsed.error.issues[0]?.message ?? "Invalid plan details.");
      return;
    }

    startTransition(async () => {
      const result = await createPlanAction(parsed.data);
      if (result.error) {
        setServerError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Plan created.");
      router.push("/dashboard/memberships/plans");
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" placeholder="e.g. Gold" {...register("name")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea id="description" rows={3} {...register("description")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="priceCents">Price (cents)</Label>
        <Input id="priceCents" type="number" min={0} {...register("priceCents")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="billingPeriod">Billing period</Label>
        <Controller
          control={control}
          name="billingPeriod"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="billingPeriod" className="w-full">
                <SelectValue>
                  {(value: string) =>
                    BILLING_OPTIONS.find((option) => option.value === value)?.label ?? value
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BILLING_OPTIONS.map((option) => (
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
        <Label htmlFor="discountPercent">Discount % (optional)</Label>
        <Input id="discountPercent" type="number" min={0} max={100} {...register("discountPercent")} />
      </div>

      <div className="flex items-center gap-3">
        <Controller
          control={control}
          name="priorityBooking"
          render={({ field }) => (
            <Switch id="priorityBooking" checked={field.value} onCheckedChange={field.onChange} />
          )}
        />
        <Label htmlFor="priorityBooking">Priority booking</Label>
      </div>

      {serverError ? <p className="text-destructive text-sm" role="alert">{serverError}</p> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Creating…" : "Create plan"}
      </Button>
    </form>
  );
}
